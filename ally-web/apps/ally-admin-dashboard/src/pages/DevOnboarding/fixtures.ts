import type { BotDraftView, TranscriptEntry } from "../Onboarding/types";

/**
 * A fictional draft for the dev harness and the browser tests (chunk 20d): the Sunrise Mind
 * fixture site as onboarding would have it. No real data.
 */
const at = "2026-11-08T10:00:00.000Z";
const say = (id: string, role: TranscriptEntry["role"], text: string, chips?: string[]) => ({
  id,
  role,
  text,
  chips,
  at,
});

export const SAFETY_LINE =
  "You work in mental health, so I've turned on **Mental health safety**. Your assistant will never diagnose, give medication advice or act as a crisis line. If someone may be at risk, it shares crisis contacts straight away and lets you know.";

/** The builder's question for each question screen, in order. */
export const QUESTIONS: { text: string; chips: string[] }[] = [
  {
    text: "One thing I couldn't find: your fees. Price is one of the first things people ask.",
    chips: ["Add it now", "Skip for now", "We don't offer this"],
  },
  {
    text: "Who will mostly talk to your assistant?",
    chips: ["Clients or customers", "My team", "Both"],
  },
  {
    text: "Which languages should it reply in? It replies in the language each person writes in, from the ones you choose.",
    chips: ["English", "Hindi", "Marathi", "Tamil", "Other"],
  },
  {
    text: "When it doesn't know something, where should it point people?",
    chips: ["Our phone number", "Our email", "Our front desk", "Somewhere else"],
  },
];

export const baseView = (): BotDraftView => ({
  id: "dev-draft",
  status: "active",
  step: "reading",
  version: 1,
  chatbotId: null,
  source: { website: "https://sunrisemind.example/", description: null },
  crawl: {
    status: "running",
    domain: "sunrisemind.example",
    startedAt: at,
    finishedAt: null,
    pagesRead: 15,
    pages: [],
    findings: [],
    brand: { logoUrl: null, accentColour: "#C4512D" },
    problem: null,
  },
  learned: {
    facts: [
      {
        id: "f1",
        section: "about",
        text: "Sunrise Mind Clinic is a counselling and therapy practice in Baner, Pune.",
        sourceUrl: "https://sunrisemind.example/",
        sourceTitle: "/",
      },
      {
        id: "f2",
        section: "services",
        text: "Individual therapy is 50 minutes, in person or online by video.",
        sourceUrl: "https://sunrisemind.example/services",
        sourceTitle: "/services",
      },
      {
        id: "f3",
        section: "team",
        text: "Dr Kavya Iyer is a clinical psychologist and the clinic's founder.",
        sourceUrl: "https://sunrisemind.example/team",
        sourceTitle: "/team",
      },
      {
        id: "f4",
        section: "location",
        text: "2nd floor, Orchid Plaza, Baner Road, Pune 411045.",
        sourceUrl: "https://sunrisemind.example/contact",
        sourceTitle: "/contact",
      },
    ],
    dropped: 0,
  },
  industry: "mental_health",
  safety: {
    id: "mental_health",
    name: "Mental health safety",
    industryLabel: "mental health practices",
    always: [
      "Explains it's an assistant, not a therapist.",
      "Shares crisis contacts straight away if someone may be at risk.",
    ],
    never: [
      "Diagnoses, gives medication advice, offers therapy or counselling, or comments on anyone's situation.",
    ],
    atRisk: [
      "Replies only with crisis contacts and encourages them to reach out now. Your team is alerted.",
    ],
    on: true,
  },
  conversation: { pending: "", gaps: null, questionsLeft: 4 },
  designs: [
    {
      id: "guide",
      title: "Client guide",
      best_for: "people asking about services and policies",
      will: ["Answer questions from your information", "Link each answer to where it came from"],
      wont: ["Book, take orders or take payments"],
      sample: [
        { from: "visitor", text: "Do you offer online sessions?" },
        { from: "assistant", text: "Yes, by video, in English, Hindi, Marathi and Tamil." },
      ],
    },
    {
      id: "enquiries",
      title: "New client enquiries",
      best_for: "collecting contact details before answering questions",
      will: ["Ask a few questions before the chat starts", "Pass each person's details to you"],
      wont: ["Book, take orders or take payments"],
      sample: [{ from: "visitor", text: "I need help with stress." }],
    },
    {
      id: "coming_soon",
      title: "Booking and payments",
      best_for: "",
      will: [],
      wont: [],
      sample: [],
      coming_soon: true,
    },
  ],
  draft: {
    name: "Sunrise Mind Clinic",
    assistantName: "Sunrise Mind",
    introduction:
      "Hi, I'm the Sunrise Mind assistant. I can help with fees, timings and our therapists.",
    instructions: "",
    tone: "professional",
    languages: ["en"],
    topics: [],
    suggestedQuestions: ["What are your fees?", "Who speaks Marathi?", "How do I book?"],
    prechat: [],
    declineText: "",
    safetyPackId: "mental_health",
    extraNever: [],
    branding: {
      logoUrl: null,
      accentColour: "#C4512D",
      title: "Sunrise Mind Clinic",
      disclaimer:
        "An assistant, not a therapist. Not a crisis service: if you might be in danger, call 112.",
      assistantName: "Sunrise Mind",
    },
    access: { mode: "invite", emails: [] },
    design: null,
  },
  transcript: [say("t0", "builder", "Hi, I'm here to set up your assistant with you.")],
  changes: [],
});

export const READING_FINDINGS = [
  "Found your services and prices",
  "Found your opening hours",
  "Found 7 team members",
  "Found 14 questions people often ask",
  "Found your address and contact details",
];

export { say };
