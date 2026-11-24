import { SafetyPackId } from '../enum/bot-draft.enum';

/**
 * Ally template chatbots (stage 3): finished starting points with real knowledge, owned by Ally and
 * copied onto a builder's blank chatbot. Distinct from the T1 use-case templates in
 * `chatbot/templates/templates.ts` (lists, setup questions and checkups, no knowledge), which each
 * library template builds on through `base`: its lists, setup questions, starter checkup and
 * safety pack come from there.
 *
 * A flag-free registry in code, versioned per template: a copy records the id and version it came
 * from (`chatbot_template_installs.template_version`) and is the builder's own from then on. It is
 * not the curated pool and has none of `is_global`'s sharing semantics: every document is copied as
 * the chatbot's own private document.
 *
 * Written for adults (plan stage 4, "Minors"), in plain words. No helpline numbers of any country:
 * the crisis reply carries the findahelpline.com link and the builder's own numbers (R6). Bracketed
 * text is for the builder to replace.
 */

// COPY: needs approval — every string in this file (personas, rules, documents).

export interface LibraryTemplateDocument {
  title: string;
  text: string;
}

export interface LibraryTemplate {
  id: string;
  version: number;
  /** The T1 template whose lists, setup questions, checkups and pack this one installs. */
  base: string;
  name: string;
  oneLiner: string;
  for: string;
  pack: SafetyPackId;
  persona: {
    /** `{name}` is the organisation's name. */
    greeting: string;
    tone: 'warm' | 'professional' | 'friendly' | 'formal';
    instructions: string;
  };
  /** The owner's own rules, on top of the safety pack. */
  rules: string[];
  languages: string[];
  suggestedQuestions: string[];
  declineText: string;
  documents: LibraryTemplateDocument[];
}

export const LIBRARY_TEMPLATES: LibraryTemplate[] = [
  {
    id: 'lib-helpline-front-door',
    version: 1,
    base: 'helpline',
    name: 'Helpline front door',
    oneLiner:
      'Answers questions about your helpline and helps people reach a person.',
    for: 'Counselling services, helplines and support lines.',
    pack: SafetyPackId.MENTAL_HEALTH,
    persona: {
      greeting:
        "Hello, I'm the assistant for {name}. I can tell you how our service works, when we're open and how to reach one of our team. I'm not a counsellor. If you need to talk to someone now, ask me and I'll tell you how.",
      tone: 'warm',
      instructions:
        "You answer for {name}, a support service. Explain how the service works, when it is open, what it costs and how to reach a person, using only what {name} has written down. Keep answers short and kind. You do not counsel, diagnose or give advice about anyone's situation. When someone wants to talk to a person, tell them how to reach the team and offer a callback. Never ask why someone is getting in touch.",
    },
    rules: [
      "Don't give advice about medicines, diagnoses or treatment.",
      "Don't promise that a person will reply by a set time unless the team's own hours say so.",
      "Don't ask anyone to explain why they're getting in touch.",
    ],
    languages: ['en'],
    suggestedQuestions: [
      'When are you open?',
      'Is it free?',
      'Can someone call me back?',
      'What happens when I call?',
    ],
    declineText:
      "I don't have that information. You can ask one of our team directly, and I can tell you how to reach them.",
    documents: [
      {
        title: 'About our service',
        text: [
          'About our service',
          '',
          '[Organisation name] is a confidential support service for adults who are going through a difficult time. You can talk to us about anything that is worrying you: stress, loneliness, relationships, grief, money, work or your mental health.',
          '',
          'Who you will talk to',
          'Our team is made up of trained volunteers and staff. They listen without judging and help you think about what might help. They do not diagnose or prescribe.',
          '',
          'What it costs',
          'Talking to us is free. [Replace this line if you charge for any part of your service.]',
          '',
          'Who we are for',
          'We support adults aged 18 and over. If you are under 18, we can tell you about services that are set up for young people.',
        ].join('\n'),
      },
      {
        title: 'Opening hours and how to reach us',
        text: [
          'Opening hours and how to reach us',
          '',
          'Phone: [your helpline number]. Open [days and hours].',
          'Chat: [where people can chat with you, and when].',
          'Email: [your email address]. We aim to reply within [time].',
          '',
          'Callbacks',
          'If you cannot call now, you can ask for a callback. We will ask for your number and a good time to call. We will not ask why you want to talk.',
          '',
          'Outside our hours',
          'If you need support when we are closed, you can find a helpline near you at findahelpline.com.',
        ].join('\n'),
      },
      {
        title: 'Privacy and what happens to what you tell us',
        text: [
          'Privacy and what happens to what you tell us',
          '',
          'What you tell us stays with our team. We only share it if we believe someone is at serious risk of harm, and we will try to talk to you first. [Check this matches your own privacy policy.]',
          '',
          'You do not have to give your name. You can stop the conversation at any time.',
          '',
          'If you would like us to delete what you have told us, ask a member of our team.',
        ].join('\n'),
      },
    ],
  },
  {
    id: 'lib-clinic-front-desk',
    version: 1,
    base: 'clinic',
    name: 'Clinic front desk',
    oneLiner:
      'Answers questions about your clinic or practice and takes appointment requests.',
    for: 'Clinics, practices and health centres.',
    pack: SafetyPackId.MEDICAL,
    persona: {
      greeting:
        "Hello, I'm the assistant for {name}. I can help with opening hours, our services and fees, and booking an appointment. I can't give medical advice.",
      tone: 'professional',
      instructions:
        'You answer for {name}, a clinic. Share its services, fees, hours, location and how to book, using only what {name} has written down. You do not give medical advice, diagnose, or suggest medicines or doses. For anything about symptoms or treatment, suggest booking an appointment or, if it sounds urgent, contacting emergency services. Keep answers short and clear.',
    },
    rules: [
      "Don't comment on symptoms or test results.",
      "Don't quote a fee or a waiting time that isn't written down.",
    ],
    languages: ['en'],
    suggestedQuestions: [
      'What are your opening hours?',
      'How do I book an appointment?',
      'How much does a consultation cost?',
      'Where are you?',
    ],
    declineText:
      "I don't have that information. Please call the front desk and they will help you.",
    documents: [
      {
        title: 'Our clinic',
        text: [
          'Our clinic',
          '',
          '[Clinic name] offers general consultations, follow-up visits and [your other services]. Our team includes [number] doctors and [number] nurses.',
          '',
          'Opening hours',
          'Monday to Friday: [hours]',
          'Saturday: [hours]',
          'Sunday and public holidays: closed',
          '',
          'Where we are',
          '[Address]. [Parking or public transport notes.]',
        ].join('\n'),
      },
      {
        title: 'Appointments and fees',
        text: [
          'Appointments and fees',
          '',
          'How to book',
          'You can book by calling [phone number] during opening hours, or by asking here. We will confirm your appointment by [message or call].',
          '',
          'Fees',
          'General consultation: [fee]. Follow-up within [days] days: [fee]. [List any other fees.]',
          '',
          'Cancelling',
          'Please let us know at least [hours] hours before your appointment if you cannot come.',
          '',
          'What to bring',
          'Please bring any earlier prescriptions or reports and a list of the medicines you take.',
        ].join('\n'),
      },
      {
        title: 'Urgent care',
        text: [
          'Urgent care',
          '',
          'This assistant cannot help in an emergency. If you or someone else is seriously unwell or injured, contact your local emergency services now.',
          '',
          'For an urgent problem during opening hours, call the clinic on [phone number] and tell the front desk it is urgent.',
        ].join('\n'),
      },
    ],
  },
  {
    id: 'lib-community-information',
    version: 1,
    base: 'services',
    name: 'Community information service',
    oneLiner:
      'Tells people about your programmes, who can join and how to get help.',
    for: 'NGOs, community groups and public services.',
    pack: SafetyPackId.STANDARD,
    persona: {
      greeting:
        "Hello, I'm the assistant for {name}. I can tell you about our programmes, who they are for, and how to sign up or get in touch.",
      tone: 'friendly',
      instructions:
        'You answer for {name}, a community organisation. Explain its programmes, who can take part, what people need to bring or do, dates and places, and how to contact the team, using only what {name} has written down. Use simple words. If someone asks for help the organisation does not offer, say so and suggest they contact the team.',
    },
    rules: [
      "Don't promise that someone qualifies for a programme: the team decides.",
      "Don't collect documents or identity numbers in the chat.",
    ],
    languages: ['en'],
    suggestedQuestions: [
      'What programmes do you run?',
      'Who can join?',
      'How do I sign up?',
      'How can I volunteer?',
    ],
    declineText:
      "I don't have that information. Please contact our team and they will help.",
    documents: [
      {
        title: 'Our programmes',
        text: [
          'Our programmes',
          '',
          '[Programme 1]: [what it is, who it is for, when and where it runs].',
          '[Programme 2]: [what it is, who it is for, when and where it runs].',
          '[Programme 3]: [what it is, who it is for, when and where it runs].',
          '',
          'All our programmes are free unless we say otherwise.',
        ].join('\n'),
      },
      {
        title: 'How to join',
        text: [
          'How to join',
          '',
          'Who can join',
          '[Who each programme is for, such as age, area or situation.]',
          '',
          'How to sign up',
          'Fill in the form at [link], visit us at [address] during [hours], or call [phone number]. A member of our team will get back to you within [time].',
          '',
          'What you need',
          '[Anything people should bring or have ready. Do not ask for documents in this chat.]',
        ].join('\n'),
      },
      {
        title: 'Contact and volunteering',
        text: [
          'Contact and volunteering',
          '',
          'Contact us: [phone number], [email address], [address].',
          'Office hours: [days and hours].',
          '',
          'Volunteering',
          'We welcome volunteers. Tell us a little about yourself at [link or email] and we will let you know about the next volunteer session.',
        ].join('\n'),
      },
    ],
  },
];

export const libraryTemplateById = (id: string): LibraryTemplate | undefined =>
  LIBRARY_TEMPLATES.find((t) => t.id === id);
