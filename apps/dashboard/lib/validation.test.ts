import { describe, expect, it } from "vitest";
import { fieldErrors, resetPasswordSchema, signInSchema, signUpSchema } from "./validation";

describe("auth form schemas", () => {
  it("normalises the email", () => {
    const parsed = signUpSchema.parse({ email: "  Sumit@Example.COM ", password: "abcdefg1" });
    expect(parsed.email).toBe("sumit@example.com");
  });

  it.each(["short1", "allletters", "12345678"])("rejects the weak password %s", (password) => {
    expect(signUpSchema.safeParse({ email: "a@b.co", password }).success).toBe(false);
  });

  it("only asks sign-in for a non-empty password", () => {
    expect(signInSchema.safeParse({ email: "a@b.co", password: "x" }).success).toBe(true);
  });

  it("puts a mismatch on the confirm field", () => {
    const result = resetPasswordSchema.safeParse({ password: "abcdefg1", confirm: "abcdefg2" });
    expect(result.success).toBe(false);
    if (!result.success) expect(fieldErrors(result.error)).toEqual({ confirm: "The two passwords don't match." });
  });
});
