import {
  CTwoFactor_AddAuthenticator_Request,
  CTwoFactor_AddAuthenticator_Response,
  CTwoFactor_FinalizeAddAuthenticator_Request,
  CTwoFactor_FinalizeAddAuthenticator_Response,
  CTwoFactor_RemoveAuthenticator_Request,
  CTwoFactor_RemoveAuthenticator_Response,
  CTwoFactor_RemoveAuthenticatorViaChallengeContinue_Request,
  CTwoFactor_RemoveAuthenticatorViaChallengeContinue_Response,
  CTwoFactor_RemoveAuthenticatorViaChallengeStart_Request,
  CTwoFactor_RemoveAuthenticatorViaChallengeStart_Response,
  CTwoFactor_Status_Request,
  CTwoFactor_Status_Response,
  CTwoFactor_Time_Request,
  CTwoFactor_Time_Response,
} from '../generated/steam-protobuf'
import { sendSteamApiRequest } from './webapi-transport'

const SERVICE = 'ITwoFactorService'

export function queryTimeProtobuf() {
  return sendSteamApiRequest({
    apiInterface: SERVICE,
    apiMethod: 'QueryTime',
    method: 'POST',
    requestType: CTwoFactor_Time_Request,
    responseType: CTwoFactor_Time_Response,
    request: CTwoFactor_Time_Request.create({}),
  })
}

export function addAuthenticator(request: CTwoFactor_AddAuthenticator_Request.$Properties, accessToken: string) {
  return sendSteamApiRequest({
    apiInterface: SERVICE,
    apiMethod: 'AddAuthenticator',
    method: 'POST',
    requestType: CTwoFactor_AddAuthenticator_Request,
    responseType: CTwoFactor_AddAuthenticator_Response,
    request: CTwoFactor_AddAuthenticator_Request.create(request),
    accessToken,
  })
}

export function finalizeAuthenticator(request: CTwoFactor_FinalizeAddAuthenticator_Request.$Properties, accessToken: string) {
  return sendSteamApiRequest({
    apiInterface: SERVICE,
    apiMethod: 'FinalizeAddAuthenticator',
    method: 'POST',
    requestType: CTwoFactor_FinalizeAddAuthenticator_Request,
    responseType: CTwoFactor_FinalizeAddAuthenticator_Response,
    request: CTwoFactor_FinalizeAddAuthenticator_Request.create(request),
    accessToken,
  })
}

export function queryStatus(request: CTwoFactor_Status_Request.$Properties, accessToken: string) {
  return sendSteamApiRequest({
    apiInterface: SERVICE,
    apiMethod: 'QueryStatus',
    method: 'POST',
    requestType: CTwoFactor_Status_Request,
    responseType: CTwoFactor_Status_Response,
    request: CTwoFactor_Status_Request.create(request),
    accessToken,
  })
}

export function removeAuthenticator(request: CTwoFactor_RemoveAuthenticator_Request.$Properties, accessToken: string) {
  return sendSteamApiRequest({
    apiInterface: SERVICE,
    apiMethod: 'RemoveAuthenticator',
    method: 'POST',
    requestType: CTwoFactor_RemoveAuthenticator_Request,
    responseType: CTwoFactor_RemoveAuthenticator_Response,
    request: CTwoFactor_RemoveAuthenticator_Request.create(request),
    accessToken,
  })
}

export function removeAuthenticatorViaChallengeStart(accessToken: string) {
  return sendSteamApiRequest({
    apiInterface: SERVICE,
    apiMethod: 'RemoveAuthenticatorViaChallengeStart',
    method: 'POST',
    requestType: CTwoFactor_RemoveAuthenticatorViaChallengeStart_Request,
    responseType: CTwoFactor_RemoveAuthenticatorViaChallengeStart_Response,
    request: CTwoFactor_RemoveAuthenticatorViaChallengeStart_Request.create({}),
    accessToken,
  })
}

export function removeAuthenticatorViaChallengeContinue(
  request: CTwoFactor_RemoveAuthenticatorViaChallengeContinue_Request.$Properties,
  accessToken: string,
) {
  return sendSteamApiRequest({
    apiInterface: SERVICE,
    apiMethod: 'RemoveAuthenticatorViaChallengeContinue',
    method: 'POST',
    requestType: CTwoFactor_RemoveAuthenticatorViaChallengeContinue_Request,
    responseType: CTwoFactor_RemoveAuthenticatorViaChallengeContinue_Response,
    request: CTwoFactor_RemoveAuthenticatorViaChallengeContinue_Request.create(request),
    accessToken,
  })
}

