export interface EmailLoginProps {
  onOtpGenerationSuccess: (email: string, expiresIn?: number) => void;
}
