import React, { useEffect, useState } from "react";

import { useNavigate, useSearchParams } from "react-router-dom";

import {
  useAcceptAssistantInviteMutation,
  useAcceptAssistantInvitePublicMutation,
  usePreviewAssistantInviteMutation,
} from "@api";
import type { AcceptedInvite, InvitePreview } from "@api";
import { Button } from "@components/button";
import { ButtonVariant } from "@components/types";
import { LOCAL_STORAGE_KEYS, ROUTES } from "@constants";

import "../../components/v2/core/styles.css";
import "../AssistantHome/home.css";
import "../AssistantHome/ui/scale.css";
import { sortRoles } from "../AssistantHome/access";
import { fill } from "../AssistantHome/copy";
import { PEOPLE } from "../AssistantHome/copy/people";
import { errorInfo } from "../AssistantHome/teamErrors";
import { ListError } from "../AssistantHome/ui/List";

const t = PEOPLE.invitePage;

const signedIn = (): boolean => {
  try {
    return localStorage.getItem(LOCAL_STORAGE_KEYS.ADMIN_IS_AUTHENTICATED) === "true";
  } catch {
    return false;
  }
};

const failureText = (failure: unknown): string => {
  const { code } = errorInfo(failure);
  if (code === "invite_wrong_email") return t.wrongEmail;
  if (code === "invite_platform_admin") return t.platformAdmin;
  if (code === "invite_not_found") return t.gone;
  return t.failed;
};

const roleWords = (roles: string[]) =>
  sortRoles(roles)
    .map(role => PEOPLE.roles[role])
    .join(", ");

/**
 * The page the invite email links to (`/assistant-invite?token=`), signed in or not. It shows what
 * the invite is for, then accepts it: as the signed-in account when their email is the invite's,
 * otherwise with the invited email typed here, after which they sign in with that email (a code
 * is emailed). The access always goes to the invited address, never to whoever holds the link.
 */
export const AssistantInvite: React.FC = () => {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const navigate = useNavigate();
  const [preview, previewing] = usePreviewAssistantInviteMutation();
  const [acceptSignedIn, { isLoading: acceptingSignedIn }] = useAcceptAssistantInviteMutation();
  const [acceptWithEmail, { isLoading: acceptingEmail }] = useAcceptAssistantInvitePublicMutation();
  const [invite, setInvite] = useState<InvitePreview | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "gone">(token ? "loading" : "gone");
  const [useEmail, setUseEmail] = useState(!signedIn());
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ accepted: AcceptedInvite; wasSignedIn: boolean } | null>(null);

  useEffect(() => {
    if (!token) return undefined;
    let live = true;
    preview({ token })
      .unwrap()
      .then(result => {
        if (!live) return;
        setInvite(result);
        setState("ready");
      })
      .catch(() => live && setState("gone"));
    return () => {
      live = false;
    };
  }, [token, preview]);

  const openIt = (accepted: AcceptedInvite) =>
    navigate(`${ROUTES.WHATSAPP_BOT}/${accepted.chatbotId}`);

  const acceptAsMe = async () => {
    setError(null);
    try {
      const accepted = await acceptSignedIn({ token }).unwrap();
      setDone({ accepted, wasSignedIn: true });
    } catch (failure) {
      setError(failureText(failure));
      // Signed in as someone else: let them type the invited address instead.
      if (errorInfo(failure).code === "invite_wrong_email") setUseEmail(true);
    }
  };

  const acceptByEmail = async () => {
    setError(null);
    try {
      const accepted = await acceptWithEmail({ token, email: email.trim() }).unwrap();
      setDone({ accepted, wasSignedIn: false });
    } catch (failure) {
      setError(failureText(failure));
    }
  };

  const goSignIn = (accepted: AcceptedInvite) => {
    // Someone signed in as another account has to leave that session to use the invited address.
    try {
      localStorage.removeItem(LOCAL_STORAGE_KEYS.ADMIN_ACCESS_TOKEN);
      localStorage.removeItem(LOCAL_STORAGE_KEYS.ADMIN_REFRESH_TOKEN);
      localStorage.removeItem(LOCAL_STORAGE_KEYS.ADMIN_IS_AUTHENTICATED);
    } catch {
      // Nothing to clear.
    }
    const next = encodeURIComponent(`${ROUTES.WHATSAPP_BOT}/${accepted.chatbotId}`);
    navigate(`${ROUTES.LOGIN}?next=${next}`);
  };

  let body: React.ReactNode;
  if (done) {
    const { accepted, wasSignedIn } = done;
    body = (
      <>
        <p className="ally-body" role="status">
          {fill(t.accepted, { name: accepted.chatbotName })}
        </p>
        {wasSignedIn ? (
          <Button type="button" onClick={() => openIt(accepted)}>
            {fill(t.openIt, { name: accepted.chatbotName })}
          </Button>
        ) : (
          <>
            <p className="ally-body">{fill(t.signInNext, { email: accepted.email })}</p>
            <Button type="button" onClick={() => goSignIn(accepted)}>
              {t.signIn}
            </Button>
          </>
        )}
      </>
    );
  } else if (state === "loading" || previewing.isLoading) {
    body = <p className="ally-body">{t.loading}</p>;
  } else if (state === "gone" || !invite) {
    body = <p className="ally-body">{token ? t.gone : t.noToken}</p>;
  } else {
    body = (
      <>
        <p className="ally-body">
          {fill(t.summary, { name: invite.chatbotName, roles: roleWords(invite.roles) })}
        </p>
        <p className="ally-small">{fill(t.sentTo, { email: invite.email })}</p>
        {!useEmail ? (
          <>
            <p className="ally-small">{t.signedInAs}</p>
            <div className="ally-btn-row">
              <Button type="button" disabled={acceptingSignedIn} onClick={() => void acceptAsMe()}>
                {acceptingSignedIn ? t.accepting : t.accept}
              </Button>
              <Button variant={ButtonVariant.TEXT} type="button" onClick={() => setUseEmail(true)}>
                {t.useCode}
              </Button>
            </div>
          </>
        ) : (
          <form
            onSubmit={event => {
              event.preventDefault();
              void acceptByEmail();
            }}
          >
            <label htmlFor="invite-email" className="ally-small">
              {t.emailHint}
            </label>
            <input
              id="invite-email"
              className="ally-input"
              type="email"
              autoComplete="email"
              aria-label={t.emailLabel}
              placeholder={t.emailLabel}
              value={email}
              maxLength={254}
              onChange={event => setEmail(event.target.value)}
            />
            <div className="ally-btn-row">
              <Button type="submit" disabled={!email.trim() || acceptingEmail}>
                {acceptingEmail ? t.accepting : t.accept}
              </Button>
            </div>
          </form>
        )}
      </>
    );
  }

  return (
    <main className="ally-v2 ally-home" data-testid="assistant-invite">
      <div className="ally-home__stack" style={{ maxWidth: 520, margin: "10vh auto 0" }}>
        <h1 className="ally-heading">{t.title}</h1>
        {body}
        <ListError error={error} />
      </div>
    </main>
  );
};
