// Minimal typings for the Shape Detection API's BarcodeDetector, which is not
// yet part of TypeScript's bundled DOM lib. Supported on Chrome/Edge/Android
// WebView; other browsers fall back to manual entry (see BarcodeScanner.tsx).

interface BarcodeDetectorOptions {
  formats?: string[];
}

interface DetectedBarcode {
  rawValue: string;
  format: string;
}

declare class BarcodeDetector {
  constructor(options?: BarcodeDetectorOptions);
  detect(image: CanvasImageSource): Promise<DetectedBarcode[]>;
}

interface Window {
  BarcodeDetector?: typeof BarcodeDetector;
}
