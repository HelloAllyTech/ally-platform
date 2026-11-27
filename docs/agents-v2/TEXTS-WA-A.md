# WA-A: new fixed texts, for approval

Every fixed text chunk WA-A adds, in one place. **Approved by Shehbaz on 26 Nov 2026**, with the changes noted below (now in the code). The code holds them in:

- `ally-be/src/whatsapp/wa-a-copy.ts`: the texts people see, and the failed-send reasons
- `ally-web/apps/ally-admin-dashboard/src/pages/Inbox/copy.ts`: `INBOX_WA`, the Inbox labels
- the other files named under sections 5 to 7 below

Each is marked `COPY: needs approval`.

Hindi and Hinglish are drafts for the internal launch, like BT1's. A native speaker should check them, and also the masculine forms (पाया, सकता), which TF1 and BT1 used too.

The rows below are the approved texts.

## 1. What people see on WhatsApp

### 1a. A voice note that can't be transcribed, or is over 2 minutes (`VOICE_NOTE_FAILED`)

This one line covers a failed transcription, an empty one, a note over 2 minutes, and audio that couldn't be downloaded from Meta. The note is always kept, and the team can play it in the Inbox.

The language comes from the person's earlier turns in this conversation (`replyLanguageOf`: Devanagari is Hindi; two or more Hinglish words are Hinglish). Only when there are none, from their WhatsApp locale (Hindi if it starts with `hi`); otherwise English. *(Changed at approval.)*

| Lang | Text | Status |
|---|---|---|
| en | Sorry, I couldn't understand that voice note. Could you type your message instead? | |
| hi | माफ़ कीजिए, मैं यह वॉइस नोट समझ नहीं पाया। क्या आप अपना संदेश लिखकर भेज सकते हैं? | |
| hi-latn | Maaf kijiye, main yeh voice note samajh nahi paaya. Kya aap apna message type karke bhej sakte hain? | |

### 1b. A photo or document with no words (`FILE_NOT_READ`)

The file is kept for the team. If the person adds a caption, the caption is answered like a typed message instead, with the crisis check first. The language follows the same rule as 1a.

| Lang | Text | Status |
|---|---|---|
| en | Thanks, I've received your file, but I can't read files yet. Could you tell me in a message what you need? | |
| hi | धन्यवाद, आपकी फ़ाइल मिल गई है, लेकिन मैं अभी फ़ाइलें नहीं पढ़ सकता। क्या आप संदेश में बता सकते हैं कि आपको क्या चाहिए? | |
| hi-latn | Dhanyavaad, aapki file mil gayi hai, lekin main abhi files nahi padh sakta. Kya aap message mein bata sakte hain ki aapko kya chahiye? | |

Videos, stickers, locations and contact cards still get the existing "I can only read text messages" setting, unchanged.

### 1c. The invite-only refusal (`INVITE_ONLY`)

This goes on every channel, after the keyword crisis check, and is followed by the crisis information as before (D4).

`{contact}` is the first phone number or email in the organisation's own sources. It is never a helpline. With no contact, the line without one is used.

| Lang | With a contact | Without | Status |
|---|---|---|---|
| en | This assistant is by invitation. Please contact {organisation} at {contact}. | This assistant is by invitation. Please contact {organisation}. | |
| hi | यह सहायक केवल आमंत्रित लोगों के लिए है। कृपया {organisation} से {contact} पर संपर्क करें। | यह सहायक केवल आमंत्रित लोगों के लिए है। कृपया {organisation} से संपर्क करें। | changed at approval |
| hi-latn | Yeh assistant sirf invite kiye gaye logon ke liye hai. Kripya {organisation} se {contact} par sampark karein. | Yeh assistant sirf invite kiye gaye logon ke liye hai. Kripya {organisation} se sampark karein. | changed at approval |

Example (en, India): "This assistant is by invitation. Please contact Sunrise Clinic at +91 98765 43210. If you're in danger, call 112 now. If you're thinking of harming yourself, call Tele-MANAS on 14416 (free, 24×7). Or find a helpline near you at https://findahelpline.com"

## 2. Why a send failed, shown in the Inbox (`FAILED_SEND_REASONS`, English)

Each reason appears after "Not delivered:". The keys are Meta's error codes.

| Meta code | Text | Status |
|---|---|---|
| 131047 | More than 24 hours have passed since they last wrote, so WhatsApp only allows an approved template now. | |
| 131026 | WhatsApp couldn't deliver it. The number may not be on WhatsApp, or their app may need updating. | |
| 131051 | WhatsApp doesn't support this kind of message. | |
| 131052 | The file they sent couldn't be downloaded from WhatsApp. | |
| 131053 | The file couldn't be sent. It may be too large, or a type WhatsApp doesn't accept. | |
| 131049 | WhatsApp held it back to limit how many business messages one person gets. Try again later. | |
| 131050 | They have chosen not to receive messages from this business. | |
| 131056 | Too many messages to this person in a short time. Try again in a few minutes. | |
| 130429 | Too many messages from this number in a short time. Try again in a few minutes. | |
| 131048 | WhatsApp is limiting messages from this number because of its quality rating. | |
| 131021 | A message can't be sent to the same number it comes from. | |
| 131031 | Meta has locked this WhatsApp number. Contact Ally. | |
| 131042 | There's a payment problem on the WhatsApp account. Contact Ally. | |
| 368 | Meta has restricted this number for a policy issue. Contact Ally. | |
| 190 | The connection to WhatsApp needs to be renewed. Contact Ally. | |
| 100 | WhatsApp rejected the format of this message. | |
| any other | WhatsApp couldn't send it. Try again, and contact Ally if it keeps failing. | |

## 3. Inbox labels (`INBOX_WA`)

| Key | Text | Status |
|---|---|---|
| delivery.sent | Sent | |
| delivery.delivered | Delivered | |
| delivery.read | Read | |
| delivery.failed | Not delivered | |
| voiceNote | Voice note | |
| transcript | Transcript (read by screen readers before the transcript) | |
| noTranscript | Couldn't be transcribed. They were asked to type it. | |
| tooLong | Over 2 minutes, so not transcribed. They were asked to type it. | |
| fileNotStored | The file couldn't be stored. | |
| openFile | Open {name} | |
| photo | Photo (the image's alt text when it has no caption) | |
| attach | Attach a file | |
| attachHint | JPEG or PNG up to {imageMb} MB, PDF or Office document up to {documentMb} MB. Your text goes with it. (5 and 25: one limit, `WHATSAPP_DOCUMENT_MAX_BYTES`, see the notes) | |
| removeFile | Remove | |
| addButtons | Add reply buttons | |
| buttonsHint | Up to 3 buttons, 20 characters each. A tap comes back as its words. | |
| buttonLabel | Button {n} | |

## 4. Errors the team can see when sending a file (ally-be)

| Where | Text | Status |
|---|---|---|
| Wrong type (`file_type`) | WhatsApp takes JPEG or PNG images, PDFs and Office documents. | |
| Too large (`file_size`) | That file is too large for WhatsApp (up to {n} MB). | |
| No storage (`file_storage`, local or dev only) | Files can't be sent from this environment. | |
| A file on a bot-page chat (`files_whatsapp_only`) | Files can be sent on WhatsApp only for now. | |

## 5. Read by the model: the `send_source_file` tool (ally-ai)

These go into the agent's prompt as the tool's description. They follow the convention used for `hand_over`.

| Part | Text | Status |
|---|---|---|
| Description | Send the person one of the organisation's own documents from your sources, as a file, when they ask for it (a form, a brochure, a price list). Only a document in your sources, never anything else. In your reply, say in one short line that the file is on its way; it is sent just after your reply. If it says there is no such file, tell them which documents you can send. | |
| `title` | The title of the document to send, exactly as it appears in your sources. | |

## 6. For Ally staff only

The Slack crisis alert sent on a late verdict, from `chatbot/safety/late-crisis.service.ts`:

> The crisis classifier fired late on chatbot "{name}" ({channel}, sender {label}, confidence {0.00}, at risk / a medical emergency). Its verdict came after the reply was sent, so the chat was flagged afterwards.

OK / change:

## 7. Not new

These are reused unchanged:

- the crisis replies, the crisis information and the holding message, all already approved;
- the emails a late verdict sends;
- the run-failed reply and BT1's button labels.
