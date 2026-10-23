import { useCallback, useEffect, useRef, useState } from "react";

import { FetchBaseQueryError } from "@reduxjs/toolkit/query";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import {
  useGenerateOTPMutation,
  useGoogleSignInMutation,
  usePutTermsAndAgreementMutation,
  useVerifyOTPMutation,
} from "@api";
import { LOCAL_STORAGE_KEYS, ROUTES, User } from "@constants";

/** The same raw key `/login` reads to prefill the email, so both pages share it. */
export const REMEMBERED_EMAIL_KEY = "rememberedEmail";

const RESEND_SECONDS = 60;
// ally-be's OTP_TTL default; the real value comes back on every generate call.
const DEFAULT_EXPIRY_MINUTES = 5;

export type CodeRequestOutcome =
  | { status: "sent"; expiryMinutes: number }
  | { status: "send-failed" };
export type VerifyOutcome = "signed-in" | "wrong-code" | "suspended" | "failed";
export type GoogleOutcome = "signed-in" | "no-account" | "suspended" | "failed";

const statusOf = (error: unknown) => (error as FetchBaseQueryError | undefined)?.status;
const messageOf = (error: unknown) =>
  ((error as FetchBaseQueryError | undefined)?.data as { message?: string } | undefined)?.message;

/**
 * Email-code and Google sign-in for the /v2 homepage, on the same endpoints,
 * terms gate and token storage as `/login`.
 *
 * One deliberate difference: an email with no account (404) or without a
 * consumer-app role (403) gets exactly the same "sent" outcome as a real one,
 * so the page never tells a stranger whether an address belongs to an Ally
 * user. The API itself still answers 404 — closing that is a backend change.
 */
export const useHomeV2SignIn = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // Same rule as /login: only ever follow a same-origin, in-app path.
  const returnTo = (() => {
    const raw = searchParams.get("returnTo");
    return raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : null;
  })();

  const [generateOTP, { isLoading: isSending }] = useGenerateOTPMutation();
  const [verifyOTP, { isLoading: isVerifying }] = useVerifyOTPMutation();
  const [googleSignIn] = useGoogleSignInMutation();
  const [putTermsAndAgreement] = usePutTermsAndAgreementMutation();

  const [isTermsOpen, setIsTermsOpen] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const tokensRef = useRef<{ access: string; refresh: string } | null>(null);
  const signedInEmailRef = useRef<string | null>(null);

  useEffect(() => {
    if (countdown <= 0) return undefined;
    const timer = setTimeout(() => setCountdown(seconds => seconds - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  const requestCode = useCallback(
    async (email: string): Promise<CodeRequestOutcome> => {
      try {
        const response = await generateOTP({ email }).unwrap();
        const minutes = response?.expiresIn
          ? Math.max(1, Math.round(response.expiresIn / 60))
          : DEFAULT_EXPIRY_MINUTES;
        setCountdown(RESEND_SECONDS);
        return { status: "sent", expiryMinutes: minutes };
      } catch (error) {
        const status = statusOf(error);
        if (status === 404 || status === 403) {
          setCountdown(RESEND_SECONDS);
          return { status: "sent", expiryMinutes: DEFAULT_EXPIRY_MINUTES };
        }
        return { status: "send-failed" };
      }
    },
    [generateOTP],
  );

  const holdTokens = (access: string, refresh: string, email: string | null) => {
    tokensRef.current = { access, refresh };
    signedInEmailRef.current = email;
    setIsTermsOpen(true);
  };

  const verifyCode = useCallback(
    async (email: string, otp: string): Promise<VerifyOutcome> => {
      try {
        const response = await verifyOTP({ email, otp }).unwrap();
        holdTokens(response.accessToken, response.refreshToken, email);
        return "signed-in";
      } catch (error) {
        if (messageOf(error)?.toLowerCase() === User.USER_SUSPENDED) {
          navigate(ROUTES.SUSPENDED_USER);
          return "suspended";
        }
        return statusOf(error) === 401 ? "wrong-code" : "failed";
      }
    },
    [navigate, verifyOTP],
  );

  /**
   * Google proves the visitor owns the address, so here it is fine to say plainly
   * that no account exists — unlike a typed email, nothing is being revealed to a
   * stranger.
   */
  const signInWithGoogle = useCallback(
    async (tokenData: { accessToken?: string; credential?: string }): Promise<GoogleOutcome> => {
      const params = tokenData.credential
        ? { idToken: tokenData.credential }
        : { accessToken: tokenData.accessToken };
      try {
        const response = await googleSignIn(params).unwrap();
        holdTokens(response.accessToken, response.refreshToken, null);
        return "signed-in";
      } catch (error) {
        if (messageOf(error)?.toLowerCase() === User.USER_SUSPENDED) {
          navigate(ROUTES.SUSPENDED_USER);
          return "suspended";
        }
        const status = statusOf(error);
        return status === 404 || status === 403 ? "no-account" : "failed";
      }
    },
    [googleSignIn, navigate],
  );

  const agreeToTerms = useCallback(async () => {
    const tokens = tokensRef.current;
    if (!tokens) return;
    const response = await putTermsAndAgreement({ token: tokens.access });
    if (!response.data?.success) {
      toast.error(t("auth.login.errors.agreeTerms"));
      return;
    }
    localStorage.setItem(LOCAL_STORAGE_KEYS.ACCESS_TOKEN, tokens.access);
    localStorage.setItem(LOCAL_STORAGE_KEYS.REFRESH_TOKEN, tokens.refresh);
    // Remembered only once the address has proved itself, so a typo is never offered back.
    if (signedInEmailRef.current) {
      localStorage.setItem(REMEMBERED_EMAIL_KEY, signedInEmailRef.current);
    }
    setIsTermsOpen(false);
    navigate(returnTo ?? ROUTES.HOME);
  }, [navigate, putTermsAndAgreement, returnTo, t]);

  return {
    requestCode,
    verifyCode,
    signInWithGoogle,
    agreeToTerms,
    isTermsOpen,
    isSending,
    isVerifying,
    countdown,
  };
};
