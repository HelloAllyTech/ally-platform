export interface OtpInputProps {
  value: string[];
  onChange: (newValue: string[]) => void;
  inputCount?: number;
  hasError?: boolean;
}
