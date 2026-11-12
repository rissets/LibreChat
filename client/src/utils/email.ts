import { z } from 'zod';

/**
 * Zod email validation schema
 * Uses Zod's built-in email validation which is more robust than simple regex
 * Based on: https://zod.dev/api?id=emails
 */
export const emailSchema = z.string().email();

/**
 * Validates an email address using Zod
 * @param email - The email address to validate
 * @param errorMessage - Optional custom error message (defaults to Zod's message)
 * @returns true if valid, error message if invalid
 */
export const validateEmail = (email: string, errorMessage?: string): true | string => {
  if (!email || email.trim() === '') {
    return true;
  }

  const result = emailSchema.safeParse(email);
  return (
    result.success ||
    errorMessage ||
    result.error.errors[0]?.message ||
    'Please enter a valid email address'
  );
};

const injectionPatternsRegex = /('|--|\$ne|\$gt|\$lt|\$or|\{|\}|\*|;|<|>|\/|=)/i;

/**
 * Validates a username or email address
 * @param value - The username or email to validate
 * @param errorMessage - Optional custom error message
 * @returns true if valid, error message if invalid
 */
export const validateUsernameOrEmail = (
  value: string,
  errorMessage?: string,
): true | string => {
  if (!value || value.trim() === '') {
    return true;
  }

  const trimmed = value.trim();
  if (trimmed.includes('@')) {
    return validateEmail(trimmed, errorMessage);
  }

  if (trimmed.length < 2 || trimmed.length > 120 || injectionPatternsRegex.test(trimmed)) {
    return errorMessage || 'Please enter a valid username or email address';
  }

  return true;
};
