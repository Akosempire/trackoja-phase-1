import { useEffect, useRef, useState } from 'react';
import { Button } from './ui/Button';

interface BarcodeScannerProps {
  onDetect: (value: string) => void;
  onClose: () => void;
}

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code'];

export function BarcodeScanner({ onDetect, onClose }: BarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stopped = false;
    let stream: MediaStream | null = null;
    let frameId = 0;
    let controls: { stop: () => void } | null = null;

    if (window.BarcodeDetector) {
      const detector = new window.BarcodeDetector({ formats: FORMATS });

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

      navigator.mediaDevices
        .getUserMedia({ video: { facingMode: 'environment' } })
        .then((mediaStream) => {
          if (stopped) {
            mediaStream.getTracks().forEach((t) => t.stop());
            return;
          }
          stream = mediaStream;
          if (videoRef.current) {
            videoRef.current.srcObject = mediaStream;
            videoRef.current.play().catch(() => {});
          }
          frameId = requestAnimationFrame(scan);
        })
        .catch((err: Error) => {
          setError(err.message || 'Unable to access the camera.');
        });
    } else {
      // Browsers without the Shape Detection API (e.g. iOS Safari) fall back to
      // ZXing, which decodes frames from getUserMedia via canvas.
      import('@zxing/browser')
        .then(({ BrowserMultiFormatReader }) => {
          if (stopped || !videoRef.current) return undefined;
          const reader = new BrowserMultiFormatReader();
          return reader.decodeFromConstraints(
            { video: { facingMode: 'environment' } },
            videoRef.current,
            (result, _err, scanControls) => {
              if (result) {
                scanControls.stop();
                onDetect(result.getText());
              }
            }
          );
        })
        .then((scanControls) => {
          if (!scanControls) return;
          if (stopped) {
            scanControls.stop();
            return;
          }
          controls = scanControls;
        })
        .catch((err: Error) => {
          setError(err.message || 'Unable to access the camera.');
        });
    }

    return () => {
      stopped = true;
      cancelAnimationFrame(frameId);
      stream?.getTracks().forEach((t) => t.stop());
      controls?.stop();
    };
  }, [onDetect]);

  return (
    <div className="scanner-overlay">
      <div className="scanner-frame">
        {error ? (
          <div className="alert alert-error">{error}</div>
        ) : (
          <>
            <video ref={videoRef} className="scanner-video" muted playsInline />
            <p className="scanner-hint">Point the camera at a barcode</p>
          </>
        )}
        <Button variant="ghost" className="btn-sm" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
