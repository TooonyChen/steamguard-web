import {
  CAuthentication_AccessToken_GenerateForApp_Request,
  CAuthentication_AccessToken_GenerateForApp_Response,
  CAuthentication_BeginAuthSessionViaCredentials_Request_BinaryGuardData,
  CAuthentication_BeginAuthSessionViaCredentials_Response,
  CAuthentication_BeginAuthSessionViaQR_Request,
  CAuthentication_BeginAuthSessionViaQR_Response,
  CAuthentication_GetAuthSessionInfo_Request,
  CAuthentication_GetAuthSessionInfo_Response,
  CAuthentication_GetAuthSessionsForAccount_Request,
  CAuthentication_GetAuthSessionsForAccount_Response,
  CAuthentication_GetPasswordRSAPublicKey_Request,
  CAuthentication_GetPasswordRSAPublicKey_Response,
  CAuthentication_PollAuthSessionStatus_Request,
  CAuthentication_PollAuthSessionStatus_Response,
  CAuthentication_UpdateAuthSessionWithMobileConfirmation_Request,
  CAuthentication_UpdateAuthSessionWithMobileConfirmation_Response,
  CAuthentication_UpdateAuthSessionWithSteamGuardCode_Request,
  CAuthentication_UpdateAuthSessionWithSteamGuardCode_Response,
} from '../generated/steam-protobuf'
import { sendSteamApiRequest } from './webapi-transport'

const SERVICE = 'IAuthenticationService'

export function fetchPasswordRsaKey(accountName: string) {
  return sendSteamApiRequest({
    apiInterface: SERVICE,
    apiMethod: 'GetPasswordRSAPublicKey',
    method: 'GET',
    requestType: CAuthentication_GetPasswordRSAPublicKey_Request,
    responseType: CAuthentication_GetPasswordRSAPublicKey_Response,
    request: CAuthentication_GetPasswordRSAPublicKey_Request.create({ accountName }),
  })
}

export function beginAuthSessionViaCredentials(request: CAuthentication_BeginAuthSessionViaCredentials_Request_BinaryGuardData.$Properties) {
  return sendSteamApiRequest({
    apiInterface: SERVICE,
    apiMethod: 'BeginAuthSessionViaCredentials',
    method: 'POST',
    requestType: CAuthentication_BeginAuthSessionViaCredentials_Request_BinaryGuardData,
    responseType: CAuthentication_BeginAuthSessionViaCredentials_Response,
    request: CAuthentication_BeginAuthSessionViaCredentials_Request_BinaryGuardData.create(request),
  })
}

export function beginAuthSessionViaQr(request: CAuthentication_BeginAuthSessionViaQR_Request.$Properties) {
  return sendSteamApiRequest({
    apiInterface: SERVICE,
    apiMethod: 'BeginAuthSessionViaQR',
    method: 'POST',
    requestType: CAuthentication_BeginAuthSessionViaQR_Request,
    responseType: CAuthentication_BeginAuthSessionViaQR_Response,
    request: CAuthentication_BeginAuthSessionViaQR_Request.create(request),
  })
}

export function pollAuthSession(request: CAuthentication_PollAuthSessionStatus_Request.$Properties) {
  return sendSteamApiRequest({
    apiInterface: SERVICE,
    apiMethod: 'PollAuthSessionStatus',
    method: 'POST',
    requestType: CAuthentication_PollAuthSessionStatus_Request,
    responseType: CAuthentication_PollAuthSessionStatus_Response,
    request: CAuthentication_PollAuthSessionStatus_Request.create(request),
  })
}

export function updateAuthSessionWithSteamGuardCode(request: CAuthentication_UpdateAuthSessionWithSteamGuardCode_Request.$Properties) {
  return sendSteamApiRequest({
    apiInterface: SERVICE,
    apiMethod: 'UpdateAuthSessionWithSteamGuardCode',
    method: 'POST',
    requestType: CAuthentication_UpdateAuthSessionWithSteamGuardCode_Request,
    responseType: CAuthentication_UpdateAuthSessionWithSteamGuardCode_Response,
    request: CAuthentication_UpdateAuthSessionWithSteamGuardCode_Request.create(request),
  })
}

export function getAuthSessionsForAccount(request: CAuthentication_GetAuthSessionsForAccount_Request.$Properties, accessToken: string) {
  return sendSteamApiRequest({
    apiInterface: SERVICE,
    apiMethod: 'GetAuthSessionsForAccount',
    method: 'GET',
    requestType: CAuthentication_GetAuthSessionsForAccount_Request,
    responseType: CAuthentication_GetAuthSessionsForAccount_Response,
    request: CAuthentication_GetAuthSessionsForAccount_Request.create(request),
    accessToken,
  })
}

export function getAuthSessionInfo(request: CAuthentication_GetAuthSessionInfo_Request.$Properties, accessToken: string) {
  return sendSteamApiRequest({
    apiInterface: SERVICE,
    apiMethod: 'GetAuthSessionInfo',
    method: 'POST',
    requestType: CAuthentication_GetAuthSessionInfo_Request,
    responseType: CAuthentication_GetAuthSessionInfo_Response,
    request: CAuthentication_GetAuthSessionInfo_Request.create(request),
    accessToken,
  })
}

export function updateAuthSessionWithMobileConfirmation(
  request: CAuthentication_UpdateAuthSessionWithMobileConfirmation_Request.$Properties,
  accessToken: string,
) {
  return sendSteamApiRequest({
    apiInterface: SERVICE,
    apiMethod: 'UpdateAuthSessionWithMobileConfirmation',
    method: 'POST',
    requestType: CAuthentication_UpdateAuthSessionWithMobileConfirmation_Request,
    responseType: CAuthentication_UpdateAuthSessionWithMobileConfirmation_Response,
    request: CAuthentication_UpdateAuthSessionWithMobileConfirmation_Request.create(request),
    accessToken,
  })
}

export function generateAccessTokenForApp(request: CAuthentication_AccessToken_GenerateForApp_Request.$Properties, accessToken: string) {
  return sendSteamApiRequest({
    apiInterface: SERVICE,
    apiMethod: 'GenerateAccessTokenForApp',
    method: 'POST',
    requestType: CAuthentication_AccessToken_GenerateForApp_Request,
    responseType: CAuthentication_AccessToken_GenerateForApp_Response,
    request: CAuthentication_AccessToken_GenerateForApp_Request.create(request),
    accessToken,
  })
}

