import { hexToBytes } from '../../src/core/numbers';
import { parseTemperatureMeasurement, ThermometerSessionReader } from '../../src/core/thermometer';
import { frame, session } from '../helpers/harness';
import { OK, err, appSuite } from '../helpers/suite';

const parse = (hex: string) => parseTemperatureMeasurement(hexToBytes(hex));

describe('Temperature Measurement frame', () => {
  test('Celsius, mantissa x 10^exponent', () => {
    expect(parse('00540e00fe')).toEqual({ celsius: 36.68, deviceTime: null }); // 3668e-2
    expect(parse(frame({ mantissa: 367, exponent: -1 }))).toEqual({ celsius: 36.7, deviceTime: null });
    expect(parse(frame({ mantissa: 37, exponent: 0 }))).toEqual({ celsius: 37, deviceTime: null });
    expect(parse(frame({ mantissa: 4, exponent: 1 }))).toEqual({ celsius: 40, deviceTime: null });
    expect(parse(frame({ mantissa: 36555, exponent: -3 }))?.celsius).toBeCloseTo(36.55, 1);
  });

  test('Fahrenheit (flag bit 0) is converted and rounded to 2 decimals', () => {
    expect(parse('01d20300ff')).toEqual({ celsius: 36.56, deviceTime: null }); // 97.8 F
    expect(parse(frame({ mantissa: 986, exponent: -1, fahrenheit: true }))?.celsius).toBe(37);
    expect(parse(frame({ mantissa: 9777, exponent: -2, fahrenheit: true }))?.celsius).toBe(36.54);
  });

  test('negative mantissa and negative exponent are signed', () => {
    expect(parse(frame({ mantissa: -55, exponent: -1 }))?.celsius).toBe(-5.5);
    expect(parse('00a6fffffe')?.celsius).toBe(-0.9);
  });

  test('timestamp (flag bit 1) is read as UTC; a type byte (flag bit 2) may follow', () => {
    expect(parse('064e0e00feea070b05061e0002')).toEqual({ celsius: 36.62, deviceTime: '2026-11-05T06:30:00Z' });
    expect(parse(frame({ mantissa: 3650, exponent: -2, time: [2026, 1, 2, 3, 4, 5] }))).toEqual({ celsius: 36.5, deviceTime: '2026-01-02T03:04:05Z' });
    expect(parse(frame({ mantissa: 3650, exponent: -2, type: 2 }))).toEqual({ celsius: 36.5, deviceTime: null });
  });

  test('a timestamp that is not a real date is treated as absent', () => {
    expect(parse(frame({ mantissa: 3650, exponent: -2, time: [2026, 13, 40, 3, 4, 5] }))).toEqual({ celsius: 36.5, deviceTime: null });
    expect(parse(frame({ mantissa: 3650, exponent: -2, time: [0, 0, 0, 0, 0, 0] }))).toEqual({ celsius: 36.5, deviceTime: null });
  });

  test('NaN mantissa is invalid', () => {
    expect(parse('00ffff7f00')).toBeNull();
    expect(parse('01ffff7fff')).toBeNull();
  });

  test('a frame shorter than its flags declare is invalid', () => {
    expect(parse('')).toBeNull();
    expect(parse('00')).toBeNull();
    expect(parse('001f0e')).toBeNull();
    expect(parse('00540e00')).toBeNull();
    const withTime = frame({ mantissa: 3650, exponent: -2, time: [2026, 1, 2, 3, 4, 5] });
    expect(parse(withTime.slice(0, -2))).toBeNull(); // timestamp one byte short
    expect(parse('02540e00fe')).toBeNull(); // says timestamp, has none
    expect(parse('04540e00fe')).toBeNull(); // says type, has none
    const withBoth = frame({ mantissa: 3650, exponent: -2, time: [2026, 1, 2, 3, 4, 5], type: 1 });
    expect(parse(withBoth.slice(0, -2))).toBeNull(); // type byte missing after the timestamp
    expect(parse(withBoth)).not.toBeNull();
  });
});

describe('session reader', () => {
  const bytes = hexToBytes(frame({ mantissa: 3650, exponent: -2 }));
  test('asks to stop once the final reading is in', () => {
    const reader = new ThermometerSessionReader();
    expect(reader.feed({ event: 'connect', deviceName: 'T' })).toBe(true);
    expect(reader.feed({ event: 'notify', char: '2A1E', bytes })).toBe(true);
    expect(reader.feed({ event: 'notify', char: '2a1c', bytes })).toBe(false);
    expect(reader.outcome()).toEqual({ kind: 'reading', deviceName: 'T', reading: { celsius: 36.5, deviceTime: null } });
  });

  test('a final reading after the disconnect does not count', () => {
    const reader = new ThermometerSessionReader();
    reader.feed({ event: 'connect', deviceName: 'T' });
    reader.feed({ event: 'disconnect' });
    reader.feed({ event: 'notify', char: '2A1C', bytes });
    expect(reader.outcome()).toEqual({ kind: 'no_final_reading' });
  });

  test('no events at all is "no final reading"', () => {
    expect(new ThermometerSessionReader().outcome()).toEqual({ kind: 'no_final_reading' });
  });
});

describe('thermometer session through the app', () => {
  const ctx = appSuite('premom');
  const AT = '2026-11-03T06:30:00Z';

  test('logs the final reading only, with the device name as reader', async () => {
    const { h, server } = ctx;
    const script = session(frame({ mantissa: 3668, exponent: -2 }), 'EasyHome-EBT-300', [frame({ mantissa: 3500, exponent: -2 }), frame({ mantissa: 3610, exponent: -2 })]);
    expect(await h.thermo(AT, script)).toEqual(OK);
    expect(h.app.snapshot().observations).toEqual([
      { type: 'bbt', observedAt: AT, source: 'thermometer', sync: 'pending', display: { celsius: 36.68 } },
    ]);
    await h.app.sync();
    const [stored] = await server.live();
    expect(stored.reader).toEqual({ deviceModel: 'EasyHome-EBT-300' });
    expect(stored).toMatchObject({ source: 'thermometer', value: { celsius: 36.68 }, observedAt: AT });
    expect(h.http.to('/v1/events')[0].request.body).toEqual({ name: 'observation_logged', props: { type: 'bbt', source: 'thermometer', pack: 'premom' } });
    expect((await server.state()).rejected).toEqual([]);
  });

  test('Fahrenheit is stored as Celsius', async () => {
    const { h } = ctx;
    await h.thermo(AT, session(frame({ mantissa: 978, exponent: -1, fahrenheit: true })));
    expect(h.app.snapshot().observations[0].display).toEqual({ celsius: 36.56 });
  });

  test('the device timestamp wins over the clock when present', async () => {
    const { h } = ctx;
    await h.thermo(AT, session(frame({ mantissa: 3650, exponent: -2, time: [2026, 11, 2, 5, 59, 7], type: 2 })));
    await h.thermo('2026-11-04T06:30:00Z', session(frame({ mantissa: 3660, exponent: -2 })));
    expect(h.app.snapshot().observations.map((o) => o.observedAt)).toEqual(['2026-11-02T05:59:07Z', '2026-11-04T06:30:00Z']);
  });

  test.each([
    ['only intermediate readings', session(null), 'thermo_no_final_reading'],
    ['NaN', session('00ffff7f00'), 'thermo_invalid_reading'],
    ['short frame', session('001f0e'), 'thermo_invalid_reading'],
    ['below the pack minimum', session(frame({ mantissa: 3399, exponent: -2 })), 'thermo_invalid_reading'],
    ['above the pack maximum', session(frame({ mantissa: 4201, exponent: -2 })), 'thermo_invalid_reading'],
    ['Fahrenheit out of range once converted', session(frame({ mantissa: 366, exponent: -1, fahrenheit: true })), 'thermo_invalid_reading'],
  ])('%s: error, nothing created', async (_name, script, code) => {
    const { h, server } = ctx;
    expect(await h.thermo(AT, script)).toEqual(err(code));
    expect(h.app.snapshot().observations).toEqual([]);
    expect(h.app.snapshot().pendingMutations).toBe(0);
    expect((await server.state()).events).toBe(0);
  });

  test('the pack limits are inclusive', async () => {
    const { h } = ctx;
    expect(await h.thermo('2026-11-03T06:30:00Z', session(frame({ mantissa: 3400, exponent: -2 })))).toEqual(OK);
    expect(await h.thermo('2026-11-04T06:30:00Z', session(frame({ mantissa: 4200, exponent: -2 })))).toEqual(OK);
  });

  test('an intermediate reading is never used, even when it is the only valid one', async () => {
    const { h } = ctx;
    const script = session('00ffff7f00', 'T', [frame({ mantissa: 3650, exponent: -2 })]);
    expect(await h.thermo(AT, script)).toEqual(err('thermo_invalid_reading'));
  });

  test('type and source are checked against the pack before Bluetooth is used', async () => {
    const { h } = ctx;
    const good = session(frame({ mantissa: 3650, exponent: -2 }));
    expect(await h.thermo(AT, good, 'pulse')).toEqual(err('unknown_type'));
    expect(await h.thermo(AT, good, 'flow')).toEqual(err('source_not_allowed'));
    expect(h.thermometer.sessions).toBe(0);
  });

  test('thermometer and strip results are read-only but can be deleted', async () => {
    const { h } = ctx;
    await h.thermo(AT, session(frame({ mantissa: 3650, exponent: -2 })));
    expect(await h.app.edit({ type: 'bbt', observedAt: AT }, { celsius: 36 })).toEqual(err('read_only'));
    expect(await h.app.edit({ type: 'bbt', observedAt: AT }, { celsius: 99 })).toEqual(err('read_only')); // read_only is checked before the value
    expect(h.app.snapshot().observations[0].display).toEqual({ celsius: 36.5 });
    expect(await h.app.delete({ type: 'bbt', observedAt: AT })).toEqual(OK);
    expect(h.app.snapshot().observations).toEqual([]);
  });
});
