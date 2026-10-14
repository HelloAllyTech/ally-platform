import { FC, useCallback, useEffect, useRef, useState } from "react";

import { FetchBaseQueryError } from "@reduxjs/toolkit/query";
import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { ComposedModal, ModalBody } from "@ally-ui-mono/ui-shared";
import {
  useGenerateOTPMutation,
  usePutTermsAndAgreementMutation,
  useVerifyOTPMutation,
} from "@api";
import { BackCircle, CloseIcon } from "@assets";
import {
  ALLY_PRIVACY_POLICY_URL,
  ALLY_TERMS_URL,
  LOCAL_STORAGE_KEYS,
  LoginSection,
} from "@constants";
import { useUser } from "@hooks";
import { openLinkInNewTab, validateEmail } from "@utils";

import { LoginPopupProps } from "./types";
import { Button } from "../button";
import OTP from "../otp";
import TermsAndAgreement from "../terms-and-agreement/TermsAndAgreement";
import TextField from "../text-field";

const LoginDialog: FC<LoginPopupProps> = ({
  isOpen,
  onClose,
  onSuccess,
  requireTerms = false,
  emailFooter,
}) => {
  const { t } = useTranslation();
  // Held until the terms are accepted when `requireTerms` is on, so nothing is
  // signed in (tokens stored) before the learner has agreed.
  const pendingTokensRef = useRef<{ accessToken: string; refreshToken: string } | null>(null);
  const [isTermsOpen, setIsTermsOpen] = useState<boolean>(false);
  const [putTermsAndAgreement] = usePutTermsAndAgreementMutation();
  const [loginSection, setLoginSection] = useState<LoginSection>(LoginSection.EMAIL);
  const [email, setEmail] = useState<string>("");
  const [emailError, setEmailError] = useState<string>("");
  const [otp, setOtp] = useState<string>("");
  const [countdown, setCountdown] = useState<number>(0);
  const [rememberMe, setRememberMe] = useState<boolean>(false);

  const [
    generateOTP,
    {
      isLoading: isGeneratingOTP,
      isSuccess: isGenerateOTPSuccess,
      data: generateOTPData,
      error: generateOTPError,
    },
  ] = useGenerateOTPMutation();
  const [
    verifyOTP,
    {
      isLoading: isVerifyingOTP,
      isSuccess: isVerifyOTPSuccess,
      data: verifyOTPData,
      error: verifyOTPError,
    },
  ] = useVerifyOTPMutation();

  const { checkAuth } = useUser();

  const isLoading = isGeneratingOTP || isVerifyingOTP;
  const isSubmitDisabled =
    loginSection === LoginSection.EMAIL ? !email || !!emailError : !otp || otp.length < 4;

  useEffect(() => {
    const rememberedEmail = localStorage.getItem("rememberedEmail");
    if (rememberedEmail) {
      setEmail(rememberedEmail);
    }
  }, []);

  useEffect(() => {
    if (generateOTPError) {
      const error = generateOTPError as FetchBaseQueryError;
      const errorData = error.data as { message: string } | undefined;
      const errorMessage = errorData?.message ?? t("auth.login.errors.generateOtp");
      toast.error(errorMessage);
    } else if (isGenerateOTPSuccess && generateOTPData) {
      setLoginSection(LoginSection.OTP);
      setCountdown(10); // Start 10 second countdown when OTP is generated
    }
  }, [isGenerateOTPSuccess, generateOTPError, generateOTPData]);

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (countdown > 0) {
      timer = setInterval(() => {
        setCountdown(prev => prev - 1);
      }, 1000);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [countdown]);

  useEffect(() => {
    (async () => {
      if (verifyOTPError) {
        const error = verifyOTPError as FetchBaseQueryError;
        const errorData = error.data as { message: string } | undefined;
        const errorMessage = errorData?.message ?? t("auth.login.errors.verifyOtp");
        toast.error(errorMessage);
      } else if (isVerifyOTPSuccess && verifyOTPData) {
        if (requireTerms) {
          pendingTokensRef.current = {
            accessToken: verifyOTPData.accessToken,
            refreshToken: verifyOTPData.refreshToken,
          };
          setIsTermsOpen(true);
          return;
        }
        await signIn(verifyOTPData.accessToken, verifyOTPData.refreshToken);
      }
    })();
  }, [isVerifyOTPSuccess, verifyOTPError, verifyOTPData]);

  const signIn = async (accessToken: string, refreshToken: string) => {
    localStorage.setItem(LOCAL_STORAGE_KEYS.ACCESS_TOKEN, accessToken);
    localStorage.setItem(LOCAL_STORAGE_KEYS.REFRESH_TOKEN, refreshToken);
    await checkAuth();
    // function to be called when OTP is verified successfully
    onSuccess();
  };

  const handleAgreeToTerms = async () => {
    const tokens = pendingTokensRef.current;
    if (!tokens) return;
    const response = await putTermsAndAgreement({ token: tokens.accessToken });
    if (!response.data?.success) {
      toast.error(t("auth.login.errors.agreeTerms"));
      return;
    }
    pendingTokensRef.current = null;
    // Sign in before leaving the terms step: flipping back first re-showed
    // the code step for as long as the session check took.
    await signIn(tokens.accessToken, tokens.refreshToken);
    setIsTermsOpen(false);
  };

  const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newEmail = e.target.value;
    setEmail(newEmail?.toLowerCase());
    if (emailError) {
      setEmailError("");
    }
  };

  const handleNext = () => {
    if (!validateEmail(email)) {
      setEmailError(t("auth.login.email.error"));
      return;
    }
    if (rememberMe) {
      localStorage.setItem("rememberedEmail", email.trim());
    }
    generateOTP({ email: email.trim() });
  };

  const handleBack = () => {
    setLoginSection(LoginSection.EMAIL);
    setOtp("");
  };

  const handleResendCode = useCallback(() => {
    if (countdown === 0) {
      generateOTP({ email });
    }
  }, [countdown, generateOTP, email]);

  const handleVerify = () => {
    verifyOTP({ email: email.trim(), otp });
  };

  const getLoginSection = () => {
    if (loginSection === LoginSection.EMAIL) {
      return (
        <motion.div
          key="email"
          initial={{ opacity: 0, x: -50 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 50 }}
          transition={{ duration: 0.4, ease: "easeInOut" }}
          className="flex flex-col gap-4"
        >
          <div className="flex flex-col text-4xl font-secondary">
            <span>{t("auth.login.greetingLine1")}</span>
            <h1>
              <span>{t("auth.login.greetingLine2", { app: "" }).replace("{{app}}", "")}</span>
              <span className="font-bold italic">ally</span>
            </h1>
            <span className="text-2xl mt-[24px]">{t("auth.login.subtitle")}</span>
          </div>
          <div className="flex flex-col gap-1">
            <TextField
              fieldSize="medium"
              type="email"
              inputMode="email"
              autoComplete="email"
              label={t("auth.login.email.label")}
              value={email}
              onChange={handleEmailChange}
              errorMessage={emailError}
              hideError={false}
              placeholder={t("auth.login.email.placeholder")}
              className="w-full rounded-xs"
            />

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="remember"
                className="h-4 w-4 rounded border-2 border-[#e3dbce] text-primary-500 focus:ring-primary-500 cursor-pointer"
                checked={rememberMe}
                onChange={e => setRememberMe(e.target.checked)}
              />
              <label htmlFor="remember" className="text-sm text-typography-700 cursor-pointer">
                {t("auth.login.rememberMe")}
              </label>
            </div>
          </div>
          <Button
            type="button"
            className="w-full rounded-[5px] mt-6"
            disabled={isLoading || isSubmitDisabled}
            onClick={handleNext}
          >
            {isLoading ? (
              <div className="flex items-center justify-center">
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-[5px] animate-spin mr-2"></div>
                {t("auth.login.generatingOtp")}
              </div>
            ) : (
              t("common.next")
            )}
          </Button>
          <div className="text-xs text-typography-800 mt-2">
            {t("auth.login.proceedAgree")}{" "}
            <span
              className="text-primary-500 cursor-pointer"
              onClick={() => openLinkInNewTab(ALLY_TERMS_URL)}
            >
              {t("auth.login.terms")}
            </span>{" "}
            {t("auth.login.and")}{" "}
            <span
              className="text-primary-500 cursor-pointer"
              onClick={() => openLinkInNewTab(ALLY_PRIVACY_POLICY_URL)}
            >
              {t("auth.login.privacy")}
            </span>
            .
          </div>
          {emailFooter}
        </motion.div>
      );
    }
    return (
      <motion.div
        key="otp"
        initial={{ opacity: 0, x: 50 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -50 }}
        transition={{ duration: 0.4, ease: "easeInOut" }}
        className="flex flex-col justify-start gap-6"
      >
        <BackCircle className="self-start cursor-pointer" onClick={handleBack} />
        <h1 className="text-4xl font-secondary">{t("auth.login.otp.title")}</h1>
        <div className="text-base mb-2 font-secondary flex flex-col">
          <span className="text-2xl">{t("auth.login.otp.enterCode")}</span>
          <span className="font-semibold text-2xl break-all">{email}</span>
        </div>
        <div className="flex flex-col gap-2">
          <OTP value={otp} onChange={setOtp} />
          <div className="text-xs text-typography-700">
            Didn't receive the code?{" "}
            <span
              className={`${countdown > 0 ? "text-typography-800" : "text-primary-500"} cursor-pointer`}
              onClick={handleResendCode}
            >
              {countdown > 0
                ? t("auth.login.otp.resendWithCountdown", { seconds: countdown })
                : t("auth.login.otp.resend")}
            </span>
          </div>
        </div>
        <Button
          type="button"
          className="w-full rounded-[5px] mt-6"
          disabled={isLoading || isSubmitDisabled}
          onClick={handleVerify}
        >
          {isLoading ? (
            <div className="flex items-center justify-center">
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-[5px] animate-spin mr-2"></div>
              {t("auth.login.otp.signingIn")}
            </div>
          ) : (
            t("auth.login.otp.verify")
          )}
        </Button>
      </motion.div>
    );
  };
  if (isTermsOpen) {
    return <TermsAndAgreement isOpen={isOpen} handleAgreeButtonClick={handleAgreeToTerms} />;
  }

  return (
    <ComposedModal open={isOpen} onClose={onClose} size="sm" className="font-primary">
      <ModalBody className="p-0">
        <motion.div
          className="max-w-[500px] min-w-[200px] flex flex-col gap-4 items-center p-4 sm:p-6 md:p-10 relative mx-4"
          initial={{ opacity: 0, scale: 0.8, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{
            duration: 0.3,
            ease: "easeOut",
            type: "spring",
            stiffness: 300,
            damping: 25,
          }}
        >
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.1, duration: 0.2 }}
            className="absolute top-3 right-3 max-md:right-1 max-md:top-1"
          >
            {/* On phones the svg's own padding makes the tap area 44px; the
                offset above shrinks to match so the icon doesn't move. */}
            <CloseIcon onClick={onClose} className="cursor-pointer max-md:box-content max-md:p-2" />
          </motion.div>
          {getLoginSection()}
        </motion.div>
      </ModalBody>
    </ComposedModal>
  );
};

export default LoginDialog;
