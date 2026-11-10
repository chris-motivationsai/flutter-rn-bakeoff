// Strip photos from the phone camera (expo-camera). The picture is scaled down, saved as PNG by
// expo-image-manipulator, decoded in JS (../pngToGray.ts) and converted to the gray bytes the engine wants.
// The engine expects a pre-cropped strip; this adapter does not find the strip in the frame.
import { Camera, CameraView } from 'expo-camera';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import React from 'react';
import { StyleSheet } from 'react-native';
import { base64ToBytes } from '../../core/numbers';
import type { GrayImage, StripCamera } from '../../core/ports';
import { pngToGray } from '../pngToGray';

const TARGET_WIDTH = 200;

export class ExpoStripCamera implements StripCamera {
  private view: CameraView | null = null;

  /** The live preview the Scan screen shows. Mounting it is what makes `capture` possible. */
  readonly Preview = (): React.JSX.Element => (
    <CameraView ref={(view) => { this.view = view; }} style={styles.preview} facing="back" />
  );

  async capture(): Promise<GrayImage> {
    const permission = await Camera.requestCameraPermissionsAsync();
    if (!permission.granted) throw new Error('camera permission denied');
    if (!this.view) throw new Error('camera preview is not mounted');
    const photo = await this.view.takePictureAsync({ quality: 1 });
    const rendered = await ImageManipulator.manipulate(photo.uri).resize({ width: TARGET_WIDTH }).renderAsync();
    const saved = await rendered.saveAsync({ format: SaveFormat.PNG, base64: true });
    if (!saved.base64) throw new Error('image manipulator returned no data');
    return pngToGray(base64ToBytes(saved.base64));
  }
}

const styles = StyleSheet.create({ preview: { height: 160, borderRadius: 8, overflow: 'hidden' } });
