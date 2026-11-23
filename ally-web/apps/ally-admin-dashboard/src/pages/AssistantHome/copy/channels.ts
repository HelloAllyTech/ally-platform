/**
 * Channels (stage 7): the page's look, its address, the sites the widget has loaded on, and the
 * page's own web address. Its own object, not part of HOME: HOME is held word for word to
 * docs/agents-v2/ONBOARDING-COPY.md by copy.test.ts.
 */
// COPY: needs approval. Every line below is new wording.
export const CHANNELS_COPY = {
  look: {
    welcome: "Welcome line",
    welcomeHint:
      "One short line under your name, before anyone types. For example: Ask us about appointments and fees.",
    lookNote: "Your page shows your name, your logo, one colour and this welcome line.",
  },
  address: {
    note: "Ally gives every assistant its own short address. It can't be changed, and old links still open it.",
  },
  limits: {
    perVisitorDay: "Messages per person per day",
    crisisNote:
      "Messages about a crisis always get the crisis information, even over these limits.",
  },
  sites: {
    title: "Sites it has loaded on",
    hint: "The chat bubble can go on any website. These are the sites it has appeared on. People still need to sign in to chat.",
    empty: "The bubble hasn't appeared on any website yet.",
    loadFailed: "Couldn't load the list of sites.",
    lastSeen: "Last seen {date}",
    loads: "About {n} loads",
  },
  domain: {
    title: "Your own web address",
    hint: "Show your assistant at an address you own, like chat.yourclinic.org. Your Ally address keeps working too.",
    hostLabel: "Your web address",
    placeholder: "chat.yourclinic.org",
    add: "Add address",
    remove: "Remove",
    removeConfirm: "Remove {host}? Your Ally address keeps working.",
    step1: "Step 1. Add this CNAME record at your domain provider",
    step2: "Step 2. Add this TXT record, so we know the domain is yours",
    step3: "Step 3. Check the records",
    type: "Type",
    name: "Name",
    value: "Value",
    copy: "Copy",
    copied: "Copied",
    check: "Check now",
    checking: "Checking…",
    dnsDelay: "Changes at your domain provider can take from a few minutes to a day to show up.",
    states: {
      ok: "Found and correct.",
      missing: "Not found yet.",
      wrong: "Found, but it points somewhere else: {found}",
      error: "We couldn't ask DNS about this record just now. Try again in a few minutes.",
      notChecked: "Not checked yet.",
    },
    cnameWrongHelp:
      "Change this record so it points to {value}. Remove any other record with the same name.",
    txtWrongHelp: "The value must be exactly {value}.",
    verified:
      "Your domain is set up. We'll confirm when your domain is ready: a secure certificate is added on our side before it opens.",
    failed: "Not ready yet. Fix the records marked above, then check again.",
    pending: "Add both records, then check.",
    lastChecked: "Last checked {date}",
    errors: {
      domain_invalid: "Enter an address like chat.yourclinic.org, without https:// or a path.",
      domain_shared: "That address is shared by many sites. Use a domain your organisation owns.",
      domain_ours: "That address already belongs to Ally. Use your own domain.",
      domain_taken: "That address is already used by another assistant.",
      domain_limit: "Remove the current address before adding another.",
      failed: "Something went wrong. Try again.",
    } as Record<string, string>,
  },
};
