import React, { useState } from "react";

import {
  AssistantLine,
  BuildSteps,
  Button,
  Chip,
  ColourPicker,
  DesignCard,
  FindingLine,
  ImageSlot,
  Kbd,
  LearnedCard,
  OptionList,
  Orb,
  PrimaryButton,
  ProgressBar,
  Question,
  SafetyCard,
  Segmented,
  TellMeSomethingElse,
  Toast,
  keysHintFor,
} from "@components/v2";

/**
 * Dev-only gallery of the Agents v2 components (chunk 20d), at /dev/v2-components, for review and
 * screenshots. Not routed in production builds. Sample text is from the copy deck.
 */
const DevV2Components: React.FC = () => {
  const [langs, setLangs] = useState<string[]>(["English"]);
  const [tone, setTone] = useState<"warm" | "balanced" | "formal">("balanced");
  const [colour, setColour] = useState("#C4512D");
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [toast, setToast] = useState(false);
  const [done, setDone] = useState(2);

  const section = (title: string, body: React.ReactNode) => (
    <section style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <h2 className="ally-label">{title}</h2>
      {body}
    </section>
  );

  return (
    <div className="ally-v2" style={{ height: "100%", overflowY: "auto" }}>
      <div
        style={{
          maxWidth: 1080,
          margin: "0 auto",
          padding: 40,
          display: "flex",
          flexDirection: "column",
          gap: 48,
        }}
      >
        <h1 className="ally-display">v2 components</h1>
        {section(
          "Orb, Kbd, buttons",
          <div className="ally-btn-row">
            <Orb size={22} />
            <Orb size={40} />
            <Orb size={56} working />
            <Kbd>A</Kbd>
            <PrimaryButton enterHint="press Enter ↵">Looks right</PrimaryButton>
            <Button>Back</Button>
            <Button variant="ghost">Tell me something else</Button>
          </div>,
        )}
        {section(
          "Question, AssistantLine, Options",
          <Question
            eyebrow="3 quick questions left"
            title="Who will mostly talk to your assistant?"
          >
            <AssistantLine>
              You work in mental health, so I&apos;ve turned on Mental health safety.
            </AssistantLine>
            <OptionList
              label="Who will mostly talk to your assistant?"
              keysHint={keysHintFor("Press {keys} to choose", 3)}
              options={[
                { id: "a", label: "Clients or customers" },
                { id: "b", label: "My team" },
                { id: "c", label: "Both" },
              ]}
              onChoose={() => undefined}
            />
          </Question>,
        )}
        {section(
          "Chips",
          <div className="ally-chips">
            {["English", "Hindi", "Marathi", "Tamil"].map(lang => (
              <Chip
                key={lang}
                selected={langs.includes(lang)}
                onToggle={() =>
                  setLangs(l => (l.includes(lang) ? l.filter(x => x !== lang) : [...l, lang]))
                }
              >
                {lang}
              </Chip>
            ))}
          </div>,
        )}
        {section("Progress", <ProgressBar value={42} label="Progress" />)}
        {section(
          "Findings",
          <ul className="ally-findings">
            <FindingLine>Found your services and prices</FindingLine>
            <FindingLine index={1}>Found 6 team members</FindingLine>
          </ul>,
        )}
        {section(
          "Learned card",
          <ul className="ally-learned-group" style={{ listStyle: "none", padding: 0, margin: 0 }}>
            <LearnedCard
              text="Sessions are 50 minutes, in person at our Baner clinic or online by video."
              source={{ label: "/services", href: "https://example.com/services" }}
              labels={{
                edit: "Edit",
                remove: "Remove",
                viewSource: "View source",
                save: "Save",
                cancel: "Cancel",
              }}
              onSave={async () => true}
              onRemove={() => undefined}
            />
          </ul>,
        )}
        {section(
          "Safety card",
          <SafetyCard
            title="Mental health safety is on"
            body="These rules are always on for mental health practices. You can add your own, but these can't be turned off."
            panels={{ always: "Always", never: "Never", atRisk: "If someone may be at risk" }}
            always={["Explains it's an assistant, not a therapist."]}
            never={[
              "Diagnoses, gives medication advice, offers therapy or counselling, or comments on anyone's situation.",
            ]}
            atRisk={["Replies only with crisis contacts and encourages them to reach out now."]}
          />,
        )}
        {section(
          "Design cards",
          <div className="ally-designs">
            <DesignCard
              title="Client guide"
              bestFor="people asking about services and policies"
              will={[
                "Answer questions from your information",
                "Link each answer to where it came from",
              ]}
              wont={["Book, take orders or take payments"]}
              sample={[
                { from: "visitor", text: "Do you offer online sessions?" },
                { from: "assistant", text: "Yes, by video, in English, Hindi and Marathi." },
              ]}
              canChoose
              labels={{
                bestFor: "Best for:",
                will: "It will:",
                wont: "It won't:",
                choose: "Choose this",
                comingSoon: "Coming soon",
              }}
              onChoose={() => undefined}
            />
            <DesignCard
              title="Booking and payments"
              comingSoon
              body="Booking and payments are on the way. For now, your assistant can collect details and pass them to you."
              labels={{
                bestFor: "Best for:",
                will: "It will:",
                wont: "It won't:",
                choose: "Choose this",
                comingSoon: "Coming soon",
              }}
            />
          </div>,
        )}
        {section(
          "Build steps",
          <>
            <BuildSteps
              steps={[
                "Writing its introduction and tone",
                "Organising what it knows",
                "Setting safety rules",
              ]}
              done={done}
            />
            <Button onClick={() => setDone(d => (d + 1) % 4)}>Next</Button>
          </>,
        )}
        {section(
          "Tone, colour, image slot",
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <Segmented
              label="Tone"
              value={tone}
              onChange={setTone}
              options={[
                { id: "warm", label: "Warm" },
                { id: "balanced", label: "Balanced" },
                { id: "formal", label: "Formal" },
              ]}
            />
            <ColourPicker
              label="Colour"
              value={colour}
              swatches={["#C4512D", "#3B3BD9", "#0F766E", "#7C3AED", "#17171C"]}
              customLabel="Custom colour"
              onChange={setColour}
            />
            <ImageSlot
              name="cover"
              labels={{ empty: "Add a cover image", replace: "Change", remove: "Remove" }}
              onFile={() => undefined}
              error="That image is over 5 MB. Try a smaller one, or export it at a lower size."
            />
          </div>,
        )}
        {section(
          "Tell me something else, toast",
          <>
            <TellMeSomethingElse
              labels={{
                collapsed: "Tell me something else",
                placeholder: "Correct something, or tell me what I missed",
                send: "Send",
                stop: "Stop",
              }}
              busy={false}
              onSend={() => undefined}
              onStop={() => undefined}
            />
            <Button onClick={() => setToast(true)}>Show toast</Button>
            {toast && (
              <Toast
                message="Changed"
                actionLabel="Undo"
                onAction={() => undefined}
                onDone={() => setToast(false)}
              />
            )}
          </>,
        )}
        {section(
          "On a visitor surface (brand colour, theme)",
          <>
            <Segmented
              label="Theme"
              value={theme}
              onChange={setTheme}
              options={[
                { id: "light", label: "Light" },
                { id: "dark", label: "Dark" },
              ]}
            />
            <div
              className="brand-surface"
              data-theme={theme}
              style={{ ["--brand-accent" as string]: colour, padding: 24, borderRadius: 20 }}
            >
              <Question
                title="Questions about therapy at Sunrise Mind?"
                as="h2"
                subtitle="Ask about fees, timings, our therapists and how to book."
              >
                <PrimaryButton>Start</PrimaryButton>
                <div className="ally-chips">
                  <Chip outline>What are your fees?</Chip>
                </div>
              </Question>
            </div>
          </>,
        )}
      </div>
    </div>
  );
};

export default DevV2Components;
