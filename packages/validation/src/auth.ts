import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(8).max(200),
});

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(16).max(2048),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(8).max(200),
  newPassword: z
    .string()
    .min(10, 'Password must be at least 10 characters')
    .max(200)
    .regex(/[A-Z]/, 'Must contain an uppercase letter')
    .regex(/[a-z]/, 'Must contain a lowercase letter')
    .regex(/[0-9]/, 'Must contain a digit')
    .regex(/[^A-Za-z0-9]/, 'Must contain a symbol'),
});

export type LoginDto = z.infer<typeof loginSchema>;
export type RefreshTokenDto = z.infer<typeof refreshTokenSchema>;
export type ChangePasswordDto = z.infer<typeof changePasswordSchema>;
