export const formatPhoneNumberForInput = (number: string): string => {
  if (!number) return '';

  // Add space after first 5 digits
  if (number.length > 5) {
    return `${number.slice(0, 5)} ${number.slice(5)}`;
  }

  return number;
};

export const formatPhoneNumberForDisplay = (number: string): string => {
  // Remove any non-numeric characters and +91 prefix if present
  const cleaned = number.replace(/^\+91[ ]?/, '').replace(/\D/g, '');

  if (cleaned.length === 10) {
    return `+91 ${cleaned.slice(0, 5)} ${cleaned.slice(5)}`;
  }

  return number;
};
