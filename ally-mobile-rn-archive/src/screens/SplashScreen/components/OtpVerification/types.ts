export interface OtpVerificationProps {
  email: string;
  onOtpVerificationSuccess: (otp: string) => void;
  initialExpiresIn?: number;
}
