export enum ttsServicesIds {
  dravidian = 'ai4bharat/indic-tts-dravidian--gpu-t4',
  misc = 'ai4bharat/indic-tts-misc--gpu-t4',
  indoAryan = 'ai4bharat/indic-tts-indo-aryan--gpu-t4',
}

export const supportedLanguages_TTS = {
  hi: {
    name: 'hi',
    ttsServiceId: ttsServicesIds.indoAryan,
  }, // Hindi
  mr: {
    name: 'mr',
    ttsServiceId: ttsServicesIds.indoAryan,
  }, // Marathi
  as: {
    name: 'as',
    ttsServiceId: ttsServicesIds.indoAryan,
  }, // Assamese
  pa: {
    name: 'pa',
    ttsServiceId: ttsServicesIds.indoAryan,
  }, // Punjabi
  gu: {
    name: 'gu',
    ttsServiceId: ttsServicesIds.indoAryan,
  }, // Gujarati
  or: {
    name: 'or',
    ttsServiceId: ttsServicesIds.indoAryan,
  }, // Odia
  bn: {
    name: 'bn',
    ttsServiceId: ttsServicesIds.indoAryan,
  }, // Bengali

  te: {
    name: 'te',
    ttsServiceId: ttsServicesIds.dravidian,
  }, // Telugu
  ta: {
    name: 'ta',
    ttsServiceId: ttsServicesIds.dravidian,
  }, // Tamil
  kn: {
    name: 'kn',
    ttsServiceId: ttsServicesIds.dravidian,
  }, // Kannada
  ml: {
    name: 'ml',
    ttsServiceId: ttsServicesIds.dravidian,
  }, // Malayalam

  mni: {
    name: 'mni',
    ttsServiceId: ttsServicesIds.misc,
  }, // Manipuri
  brx: {
    name: 'brx',
    ttsServiceId: ttsServicesIds.misc,
  }, // Bodo
  en: {
    name: 'en',
    ttsServiceId: ttsServicesIds.misc,
  }, // English
};
