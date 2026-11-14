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
      id: "enquiries",
      title: "Bring in customers",
      best_for: "people choosing between therapy services",
      will: [
        "Recommend the service that fits",
        "Ask one question at a time",
        "Pass each person's name and number to you",
      ],
      wont: ["Book, take orders or take payments", "Promise discounts or slots you haven't listed"],
      sample: [
        { from: "visitor", text: "I need help with stress." },
        { from: "assistant", text: "Happy to help. Is it for you, or for a family member?" },
      ],
      recommended: true,
      limit: "It can't book or take payments yet. It sends you each new enquiry by email.",
    },
    {
      id: "answer",
      title: "Answer questions",
      best_for: "people asking about services and policies",
      will: [
        "Answer questions from your information",
        "Link each answer to where it came from",
        "Say plainly when it doesn't know",
      ],
      wont: ["Book, take orders or take payments"],
      sample: [
        { from: "visitor", text: "Do you offer online sessions?" },
        { from: "assistant", text: "Yes, by video, in English, Hindi, Marathi and Tamil." },
      ],
    },
    {
      id: "guide",
      title: "Guide people step by step",
      best_for: "getting ready for a first session",
      will: [
        "Give one step at a time",
        "Check each step is done before the next",
        "Keep your steps in order, safety steps included",
      ],
      wont: ["Skip or reorder steps", "Book, take orders or take payments"],
      sample: [
        { from: "visitor", text: "How do I get ready?" },
        { from: "assistant", text: "Here's the first step. Tell me when it's done." },
      ],
    },
    {
      id: "training",
      title: "Train my team",
      best_for: "new staff learning your procedures",
      will: [
        "Explain your procedures in short steps",
        "Quiz your team when they ask",
        "Link each answer to your documents",
      ],
      wont: ["Make up a procedure"],
      sample: [
        { from: "visitor", text: "Test me on our procedures." },
        { from: "assistant", text: "Sure. First question: what's the first step?" },
      ],
      limit: "It doesn't keep track of each person's progress yet.",
    },
    {
      id: "custom",
      title: "Something else",
      best_for: "Describe what you need, and I'll set it up.",
      will: [],
      wont: [],
      sample: [],
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
