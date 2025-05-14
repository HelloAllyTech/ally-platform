export interface OtpVerificationProps {
  phoneNumber: string;
  onOtpVerificationSuccess: (otp: string) => void;
}
