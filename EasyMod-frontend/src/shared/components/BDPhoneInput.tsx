/**
 * BDPhoneInput — Bangladesh phone number input component.
 *
 * Locked +880 prefix, 10-digit entry, formats as 01XXX-XXX-XXX,
 * validates against BD mobile regex ^01[3-9]\d{8}$.
 * Raw value in form state is the full 11-digit number (01XXXXXXXXX).
 *
 * Uses only shadcn/ui Input + Label primitives — no new UI library.
 */
import * as React from 'react';
import { Input } from '@/app/components/ui/input';
import { Label } from '@/app/components/ui/label';
import { cn } from '@/app/components/ui/utils';

const BD_PHONE_REGEX = /^01[3-9]\d{8}$/;

function formatBDPhone(raw: string): string {
  // raw = up to 11 digits starting with 01
  const digits = raw.replace(/\D/g, '').slice(0, 11);
  if (digits.length <= 5) return digits;
  if (digits.length <= 8) return `${digits.slice(0, 5)}-${digits.slice(5)}`;
  return `${digits.slice(0, 5)}-${digits.slice(5, 8)}-${digits.slice(8)}`;
}

export interface BDPhoneInputProps {
  /** Raw 11-digit value stored in form state (01XXXXXXXXX). */
  value: string;
  /** Called with the raw 11-digit value on every valid digit change. */
  onChange: (rawValue: string) => void;
  error?: string;
  label?: string;
  required?: boolean;
  disabled?: boolean;
  id?: string;
  placeholder?: string;
  className?: string;
}

const BDPhoneInput = React.forwardRef<HTMLInputElement, BDPhoneInputProps>(
  function BDPhoneInput(
    { value, onChange, error, label, required, disabled, id, placeholder = '01XXX-XXX-XXX', className },
    ref
  ) {
    const inputId = id ?? 'bd-phone-input';
    const isValid = !value || BD_PHONE_REGEX.test(value);
    const showError = error || (!isValid && value.length > 0);

    function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
      // Strip everything except digits, cap at 11
      const raw = e.target.value.replace(/\D/g, '').slice(0, 11);
      onChange(raw);
    }

    return (
      <div className={cn('space-y-1', className)}>
        {label && (
          <Label htmlFor={inputId} className="text-sm font-medium text-gray-700">
            {label}
            {required && <span className="text-red-500 ml-0.5">*</span>}
          </Label>
        )}
        <div className="flex h-9 rounded-md border border-input bg-input-background overflow-hidden focus-within:border-ring focus-within:ring-ring/50 focus-within:ring-[3px] transition-[color,box-shadow]">
          {/* Locked +880 prefix adornment */}
          <span className="flex items-center px-3 text-sm text-muted-foreground bg-muted border-r border-input select-none shrink-0">
            +880
          </span>
          <Input
            ref={ref}
            id={inputId}
            type="tel"
            inputMode="numeric"
            value={formatBDPhone(value)}
            onChange={handleChange}
            placeholder={placeholder}
            disabled={disabled}
            aria-invalid={showError ? true : undefined}
            aria-required={required}
            aria-describedby={showError ? `${inputId}-error` : undefined}
            // Remove the Input's own border/background so our wrapper controls it
            className="border-0 bg-transparent focus-visible:ring-0 focus-visible:border-0 h-full rounded-none flex-1 px-3"
          />
        </div>
        {showError && (
          <p id={`${inputId}-error`} className="text-xs text-destructive mt-0.5">
            {error ?? 'সঠিক বাংলাদেশি মোবাইল নম্বর দিন (01X-XXXX-XXXX)'}
          </p>
        )}
      </div>
    );
  }
);

BDPhoneInput.displayName = 'BDPhoneInput';

export { BDPhoneInput, BD_PHONE_REGEX };
