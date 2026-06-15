import { useEffect, useRef, useState } from 'react';
import { Button } from './ui/Button';

interface BarcodeScannerProps {
  onDetect: (value: string) => void;
  onClose: () => void;
}

const SHAPE_DETECTOR_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code'];

// Most-specific constraints first; we fall back to looser ones if the
// device/browser rejects them (OverconstrainedError).
const VIDEO_CONSTRAINTS: MediaStreamConstraints[] = [
  {
    video: {
      facingMode: 'environment',
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      advanced: [{ focusMode: 'continuous' }],
    } as unknown as MediaTrackConstraints,
  },
  { video: { facingMode: 'environment' } },
  { video: true },
];

export function BarcodeScanner({ onDetect, onClose }: BarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manualValue, setManualValue] = useState('');
  const [torchOn, setTorchOn] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);

  useEffect(() => {
    let stopped = false;
    let stream: MediaStream | null = null;
    let frameId = 0;
    let controls: { stop: () => void } | null = null;

    const setupTrack = (mediaStream: MediaStream) => {
      const track = mediaStream.getVideoTracks()[0];
      if (!track) return;
      trackRef.current = track;
      const capabilities = track.getCapabilities?.() as MediaTrackCapabilities & { torch?: boolean };
      if (capabilities?.torch) setTorchSupported(true);
    };

    const getStream = async (): Promise<MediaStream> => {
      let lastErr: unknown;
      for (const constraints of VIDEO_CONSTRAINTS) {
        try {
          return await navigator.mediaDevices.getUserMedia(constraints);
        } catch (err) {
          lastErr = err;
        }
      }
      throw lastErr instanceof Error ? lastErr : new Error('Unable to access the camera.');
    };

    const startShapeDetector = async () => {
      const detector = new window.BarcodeDetector!({ formats: SHAPE_DETECTOR_FORMATS });

      const scan = async () => {
        if (stopped || !videoRef.current) return;
        try {
          const codes = await detector.detect(videoRef.current);
          if (codes.length > 0) {
            onDetect(codes[0].rawValue);
            return;
          }
        } catch {
          // Ignore transient per-frame detection errors and keep scanning.
        }
        frameId = requestAnimationFrame(scan);
      };

      const mediaStream = await getStream();
      if (stopped) {
        mediaStream.getTracks().forEach((t) => t.stop());
        return;
      }
      stream = mediaStream;
      setupTrack(mediaStream);
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
        await videoRef.current.play().catch(() => {});
      }
      frameId = requestAnimationFrame(scan);
    };

    const startZXing = async () => {
      const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([
        import('@zxing/browser'),
        import('@zxing/library'),
      ]);
      if (stopped || !videoRef.current) return;

      const hints = new Map();
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [
        BarcodeFormat.EAN_13,
        BarcodeFormat.EAN_8,
        BarcodeFormat.UPC_A,
        BarcodeFormat.UPC_E,
        BarcodeFormat.CODE_128,
        BarcodeFormat.CODE_39,
        BarcodeFormat.QR_CODE,
      ]);
      hints.set(DecodeHintType.TRY_HARDER, true);

      const reader = new BrowserMultiFormatReader(hints);

      let lastErr: unknown;
      for (const constraints of VIDEO_CONSTRAINTS) {
        if (stopped || !videoRef.current) return;
        try {
          const scanControls = await reader.decodeFromConstraints(constraints, videoRef.current, (result) => {
            if (result) {
              scanControls.stop();
              onDetect(result.getText());
            }
          });
          if (stopped) {
            scanControls.stop();
            return;
          }
          controls = scanControls;
          const mediaStream = videoRef.current.srcObject as MediaStream | null;
          if (mediaStream) setupTrack(mediaStream);
          return;
        } catch (err) {
          lastErr = err;
        }
      }
      throw lastErr instanceof Error ? lastErr : new Error('Unable to access the camera.');
    };

    const start = async () => {
      if (window.BarcodeDetector) {
        try {
          await startShapeDetector();
          return;
        } catch {
          // Fall back to ZXing below. Release any stream the attempt opened.
          stream?.getTracks().forEach((t) => t.stop());
          stream = null;
          cancelAnimationFrame(frameId);
        }
      }
      try {
        await startZXing();
      } catch (err) {
        if (!stopped) setError(err instanceof Error ? err.message : 'Unable to access the camera.');
      }
    };

    start();

    return () => {
      stopped = true;
      cancelAnimationFrame(frameId);
      stream?.getTracks().forEach((t) => t.stop());
      controls?.stop();
    };
  }, [onDetect]);

  const toggleTorch = async () => {
    const track = trackRef.current;
    if (!track) return;
    try {
      await track.applyConstraints({ advanced: [{ torch: !torchOn }] } as unknown as MediaTrackConstraints);
      setTorchOn(!torchOn);
    } catch {
      // Torch toggle is best-effort; ignore unsupported devices.
    }
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const value = manualValue.trim();
    if (value) onDetect(value);
  };

  return (
    <div className="scanner-overlay">
      <div className="scanner-frame">
        {error ? (
          <div className="alert alert-error">{error}</div>
        ) : (
          <div className="scanner-video-wrap">
            <video ref={videoRef} className="scanner-video" muted playsInline />
            <div className="scanner-guide" />
          </div>
        )}
        <p className="scanner-hint">Point the camera at a barcode</p>
        <div className="btn-row">
          {torchSupported && (
            <Button type="button" variant="ghost" className="btn-sm" onClick={toggleTorch}>
              {torchOn ? 'Torch off' : 'Torch on'}
            </Button>
          )}
          <Button type="button" variant="ghost" className="btn-sm" onClick={onClose}>
            Cancel
          </Button>
        </div>
        <form className="scanner-manual" onSubmit={handleManualSubmit}>
          <input
            className="form-input"
            placeholder="Or type the code manually"
            value={manualValue}
            onChange={(e) => setManualValue(e.target.value)}
          />
          <Button type="submit" className="btn-sm">
            Use
          </Button>
        </form>
      </div>
    </div>
  );
}
