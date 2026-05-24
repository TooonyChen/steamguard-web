export function generateDeviceId(): string {
  return `android:${crypto.randomUUID()}`
}

