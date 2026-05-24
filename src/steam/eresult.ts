export enum EResult {
  Invalid = 0,
  OK = 1,
  Fail = 2,
  InvalidPassword = 5,
  InvalidParam = 8,
  AccessDenied = 15,
  Timeout = 16,
  NotLoggedOn = 21,
  Pending = 22,
  Expired = 27,
  AlreadyRedeemed = 28,
  DuplicateRequest = 29,
  AccountLogonDenied = 63,
  AccountLoginDeniedNeedTwoFactor = 85,
  TwoFactorCodeMismatch = 88,
  RateLimitExceeded = 84,
  TimeNotSynced = 93,
}

export function eresultName(value: number): string {
  return EResult[value] ?? `EResult(${value})`
}

