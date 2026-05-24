import { useEffect, useRef, useState } from "react";
import { CameraIcon, QrCodeIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

type BarcodeDetectorResult = {
  rawValue?: string;
};

type BarcodeDetectorLike = {
  detect(source: HTMLVideoElement): Promise<BarcodeDetectorResult[]>;
};

type BarcodeDetectorConstructor = new (options?: {
  formats?: string[];
}) => BarcodeDetectorLike;

type WindowWithBarcodeDetector = Window & {
  BarcodeDetector?: BarcodeDetectorConstructor;
};

function isSteamQrChallenge(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (
      parsed.hostname === "s.team" && /^\/q\/\d+\/\d+$/.test(parsed.pathname)
    );
  } catch {
    return false;
  }
}

export function QrLoginScannerDialog({
  accountName,
  open,
  onOpenChange,
  onDetected,
}: {
  accountName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDetected: (url: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const onDetectedRef = useRef(onDetected);
  const [manualUrl, setManualUrl] = useState("");
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    onDetectedRef.current = onDetected;
  }, [onDetected]);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    let frame = 0;

    async function startScanner() {
      setManualUrl("");
      setScanError(null);
      setScanning(true);

      const Detector = (window as WindowWithBarcodeDetector).BarcodeDetector;
      if (!Detector) {
        setScanning(false);
        setScanError(
          "This browser cannot scan QR codes directly. Paste the Steam QR URL instead.",
        );
        return;
      }

      if (!navigator.mediaDevices?.getUserMedia) {
        setScanning(false);
        setScanError(
          "Camera access is not available in this browser. Paste the Steam QR URL instead.",
        );
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();

        const detector = new Detector({ formats: ["qr_code"] });
        const tick = async () => {
          if (cancelled || !videoRef.current) return;
          try {
            const codes = await detector.detect(videoRef.current);
            const rawValue = codes
              .map((code) => code.rawValue || "")
              .find(isSteamQrChallenge);
            if (rawValue) {
              onDetectedRef.current(rawValue);
              onOpenChange(false);
              return;
            }
          } catch {
            // Keep scanning; transient decode failures are normal while the camera moves.
          }
          frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
      } catch (err) {
        setScanError(
          err instanceof Error ? err.message : "Camera permission was denied.",
        );
      } finally {
        setScanning(false);
      }
    }

    void startScanner();

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
    };
  }, [open, onOpenChange]);

  function submitManualUrl(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = manualUrl.trim();
    if (!isSteamQrChallenge(trimmed)) {
      setScanError("Paste a Steam QR URL like https://s.team/q/1/123456789.");
      return;
    }
    onDetected(trimmed);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Scan Steam QR login</DialogTitle>
          <DialogDescription>
            Scan the QR shown by Steam for {accountName}. You will review it
            before accepting or denying.
          </DialogDescription>
        </DialogHeader>

        <div className="overflow-hidden rounded-lg border bg-muted/30">
          <video
            ref={videoRef}
            className="aspect-video w-full bg-background object-cover"
            muted
            playsInline
          />
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          {scanning ? (
            <CameraIcon className="size-4" />
          ) : (
            <QrCodeIcon className="size-4" />
          )}
          <span>
            {scanning
              ? "Starting camera"
              : "Point the camera at the Steam QR code."}
          </span>
        </div>
        {scanError ? (
          <p className="text-sm text-destructive">{scanError}</p>
        ) : null}

        <form onSubmit={submitManualUrl} className="flex flex-col gap-3">
          <Field>
            <FieldLabel>Steam QR URL</FieldLabel>
            <Input
              placeholder="https://s.team/q/..."
              value={manualUrl}
              onChange={(event) => setManualUrl(event.target.value)}
            />
            <FieldDescription>
              Use this if camera scanning is unavailable.
            </FieldDescription>
          </Field>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!manualUrl.trim()}>
              Review login
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
