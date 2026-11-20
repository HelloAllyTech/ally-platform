import { QuoteSlide } from "./QuoteCarousel";

export type LandingLang = "hi" | "en";

/**
 * Copy for the parent-campaign landing page prototype. English is the default.
 * Bracketed values are placeholders to be replaced once the real helpline
 * number, counts and quotes are decided. The quote slides are placeholders on
 * purpose: nothing is attributed to a real person until a real, approved quote
 * is supplied.
 */
export interface LandingCopy {
  title: string;
  description: string;
  helpline: string;
  logIn: string;
  login: {
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
  };
  heading: string;
  tagline: string;
  sub: string;
  courses: { name: string; body: string; count: string };
  practice: { name: string; body: string; count: string };
  resources: { name: string; body: string; count: string };
  breadcrumbLabel: string;
  breadcrumbHome: string;
  items: { practice: string; courses: string; resources: string };
  itemDescription: string;
  quotesLabel: string;
  quotesPrevious: string;
  quotesNext: string;
  quotesGoTo: string;
  quotes: QuoteSlide[];
  disclaimer: string;
}

export const LANDING_COPY: Record<LandingLang, LandingCopy> = {
  hi: {
    title: "बात से बात बनेगी",
    description: "माता-पिता के लिए छोटे कोर्स और बातचीत का सुरक्षित अभ्यास।",
    helpline: "अभी मदद चाहिए? [हेल्पलाइन नंबर] पर कॉल करें, 24 घंटे, निःशुल्क",
    logIn: "लॉग इन",
    login: {
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
      prototypeNote: "यह एक प्रोटोटाइप है। लॉग इन अभी जुड़ा नहीं है।",
    },
    heading: "बात से बात बनेगी",
    tagline: "अपने बच्चे से मुश्किल बातचीत की तैयारी करें",
    sub: "छोटे कोर्स और सुरक्षित अभ्यास, ताकि सही समय पर आप सही बात कह सकें।",
    courses: {
      name: "कोर्स",
      body: "संकेत पहचानना और बात शुरू करना सीखें। हर पाठ 5 मिनट का।",
      count: "[3] कोर्स",
    },
    practice: {
      name: "बातचीत का अभ्यास",
      body: "एक वर्चुअल किशोर के साथ बात करने का अभ्यास करें, बिना किसी दबाव के।",
      count: "[4] अभ्यास",
    },
    resources: {
      name: "संसाधन",
      body: "माता-पिता के लिए गाइड, हेल्पलाइन और पढ़ने की सामग्री।",
      count: "[5] संसाधन",
    },
    breadcrumbLabel: "नेविगेशन पथ",
    breadcrumbHome: "होम",
    items: { practice: "[अभ्यास]", courses: "[कोर्स]", resources: "[संसाधन]" },
    itemDescription: "[संक्षिप्त विवरण]",
    quotesLabel: "माता-पिता की भूमिका पर विचार",
    quotesPrevious: "पिछला उद्धरण",
    quotesNext: "अगला उद्धरण",
    quotesGoTo: "उद्धरण {n} पर जाएं",
    quotes: [
      {
        quote: "[बच्चों की आत्महत्या रोकथाम में माता-पिता की भूमिका पर उद्धरण 1]",
        name: "[हस्ती का नाम]",
        role: "[अभिनेता / अभिनेत्री]",
      },
      { quote: "[उद्धरण 2]", name: "[हस्ती का नाम]", role: "[अभिनेता / अभिनेत्री]" },
      { quote: "[उद्धरण 3]", name: "[हस्ती का नाम]", role: "[अभिनेता / अभिनेत्री]" },
      { quote: "[उद्धरण 4]", name: "[हस्ती का नाम]", role: "[अभिनेता / अभिनेत्री]" },
    ],
    disclaimer:
      "यह एक प्रशिक्षण उपकरण है, परामर्श या आपातकालीन सेवा नहीं। संकट में हों तो ऊपर दिए नंबर पर कॉल करें।",
  },
  en: {
    title: "Baat Se Baat Banegi",
    description: "Short courses and safe conversation practice for parents.",
    helpline: "Need help right now? Call [helpline number], 24 hours, free",
    logIn: "Log in",
    login: {
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
      prototypeNote: "This is a prototype. Log in isn't connected yet.",
    },
    heading: "Baat Se Baat Banegi",
    tagline: "Get ready for a hard conversation with your child",
    sub: "Short courses and safe practice, so you can say the right thing at the right time.",
    courses: {
      name: "Courses",
      body: "Learn to spot the signs and start the conversation. Each lesson takes 5 minutes.",
      count: "[3] courses",
    },
    practice: {
      name: "Conversation practice",
      body: "Practise talking with a virtual teenager, with no pressure.",
      count: "[4] practices",
    },
    resources: {
      name: "Resources",
      body: "Guides, helplines and reading material for parents.",
      count: "[5] resources",
    },
    breadcrumbLabel: "Breadcrumb",
    breadcrumbHome: "Home",
    items: { practice: "[Practice]", courses: "[Course]", resources: "[Resource]" },
    itemDescription: "[Short description]",
    quotesLabel: "Voices on a parent's role",
    quotesPrevious: "Previous quote",
    quotesNext: "Next quote",
    quotesGoTo: "Go to quote {n}",
    quotes: [
      {
        quote: "[Quote 1 on a parent's role in preventing suicide among children]",
        name: "[Celebrity name]",
        role: "[Actor]",
      },
      { quote: "[Quote 2]", name: "[Celebrity name]", role: "[Actor]" },
      { quote: "[Quote 3]", name: "[Celebrity name]", role: "[Actor]" },
      { quote: "[Quote 4]", name: "[Celebrity name]", role: "[Actor]" },
    ],
    disclaimer:
      "This is a training tool, not counselling or an emergency service. If someone is in crisis, call the number above.",
  },
};
