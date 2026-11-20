import type { LandingLanguage } from "@ally-ui-mono/ui-shared";

export interface LoginCopy {
  title: string;
  emailTab: string;
  mobileTab: string;
  emailLabel: string;
  emailPlaceholder: string;
  mobileLabel: string;
  mobilePlaceholder: string;
  codeHint: string;
  sendCode: string;
  legalPrefix: string;
  termsLink: string;
  legalAnd: string;
  privacyLink: string;
  legalSuffix: string;
  emailError: string;
  mobileError: string;
  prototypeNote: string;
}

const EN: LoginCopy = {
  title: "Log in",
  emailTab: "Email",
  mobileTab: "Mobile",
  emailLabel: "Email address",
  emailPlaceholder: "name@company.com",
  mobileLabel: "Mobile number",
  mobilePlaceholder: "10-digit number",
  codeHint: "We'll send you a one-time code.",
  sendCode: "Send code",
  legalPrefix: "By continuing, you agree to the ",
  termsLink: "Terms of use",
  legalAnd: " and ",
  privacyLink: "Privacy policy",
  legalSuffix: ".",
  emailError: "Enter a valid email address",
  mobileError: "Enter a 10-digit mobile number",
  prototypeNote: "Log in isn't connected yet.",
};

const HI: LoginCopy = {
  title: "लॉग इन",
  emailTab: "ईमेल",
  mobileTab: "मोबाइल",
  emailLabel: "ईमेल पता",
  emailPlaceholder: "name@company.com",
  mobileLabel: "मोबाइल नंबर",
  mobilePlaceholder: "10 अंकों का नंबर",
  codeHint: "हम आपको एक बार इस्तेमाल होने वाला कोड भेजेंगे।",
  sendCode: "कोड भेजें",
  legalPrefix: "जारी रखकर, आप ",
  termsLink: "उपयोग की शर्तें",
  legalAnd: " और ",
  privacyLink: "गोपनीयता नीति",
  legalSuffix: " से सहमत होते हैं।",
  emailError: "सही ईमेल पता डालें",
  mobileError: "10 अंकों का मोबाइल नंबर डालें",
  prototypeNote: "लॉग इन अभी जुड़ा नहीं है।",
};

/**
 * The login panel's words. English and Hindi are written; Marathi, Tamil and
 * Kannada show English until a native speaker has written them.
 */
export const loginCopyFor = (language: LandingLanguage): LoginCopy => (language === "hi" ? HI : EN);
