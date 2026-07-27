import { z } from "zod";

export const signinSchema = z.object({
  email: z
    .string()
    .min(1, "Email is required")
    .email("Please enter a valid email address"),
  password: z.string().min(1, "Password is required"),
  rememberMe: z.boolean().default(false),
});

export type SigninFormData = z.infer<typeof signinSchema>;

export const signupSchema = z
  .object({
    fullName: z
      .string()
      .min(2, "Name must be at least 2 characters")
      .max(100, "Name must be less than 100 characters"),
    email: z
      .string()
      .min(1, "Email is required")
      .email("Please enter a valid email address"),
    phone: z
      .string()
      .min(1, "Mobile number is required")
      .regex(
        /^01[3-9]\d{8}$/,
        "Enter a valid 11-digit mobile number (01XXXXXXXXX)"
      ),
    // Must stay in lockstep with PASSWORD_RULES in ./passwordPolicy — the API
    // rejects passwords without a special character, so the client must too.
    // __tests__/passwordPolicy.test.ts asserts the two definitions agree.
    password: z
      .string()
      .min(8, "Password must be at least 8 characters")
      .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
      .regex(/[a-z]/, "Password must contain at least one lowercase letter")
      .regex(/[0-9]/, "Password must contain at least one number")
      .regex(/[^A-Za-z0-9]/, "Password must contain at least one special character"),
    acceptedTerms: z.boolean().refine((val) => val === true, {
      message: "You must accept the terms and conditions",
    }),
  })
  .strict();

export type SignupFormData = z.infer<typeof signupSchema>;
