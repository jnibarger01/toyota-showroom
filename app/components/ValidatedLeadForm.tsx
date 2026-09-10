"use client";

import { useId, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { submitLead } from "../../lib/api/leads";
import { newId } from "../../lib/shared/id";

type FormValues = {
  name: string;
  email: string;
  message: string;
};

type FormErrors = Partial<Record<keyof FormValues, string>>;

type Props = {
  /** Test/future-provider injection. When omitted, the form submits to POST /api/v1/leads. */
  onSubmit?: (values: FormValues) => Promise<void> | void;
};

const initialValues: FormValues = { name: "", email: "", message: "" };
const SUBMISSION_ERROR = "Your request was not sent. Please try again.";

function validate(values: FormValues): FormErrors {
  const errors: FormErrors = {};
  if (!values.name.trim()) errors.name = "Enter your name so we know who to contact.";
  else if (values.name.trim().length > 120) errors.name = "Use 120 characters or fewer for your name.";

  if (!values.email.trim()) errors.email = "Enter an email address for your reply.";
  else if (values.email.trim().length > 254) errors.email = "Use an email address with 254 characters or fewer.";
  else if (!/^\S+@\S+\.\S+$/.test(values.email)) errors.email = "Use an email address like you@example.com.";

  if (!values.message.trim()) errors.message = "Tell us what you would like help with.";
  else if (values.message.trim().length > 4_000) errors.message = "Use 4,000 characters or fewer for your request.";
  return errors;
}

function validateField(field: keyof FormValues, values: FormValues): string | undefined {
  return validate(values)[field];
}

export function ValidatedLeadForm({ onSubmit }: Props) {
  const formId = useId();
  const idempotencyKey = useRef<string | null>(null);
  const [values, setValues] = useState(initialValues);
  const [errors, setErrors] = useState<FormErrors>({});
  const [touched, setTouched] = useState<Partial<Record<keyof FormValues, boolean>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submissionError, setSubmissionError] = useState<string | null>(null);

  const updateField = (field: keyof FormValues, value: string) => {
    const nextValues = { ...values, [field]: value };
    setValues(nextValues);
    setSubmissionError(null);
    // A changed payload is a new logical request. A retry with unchanged values keeps the same key
    // so a lost response cannot duplicate an already-accepted D1 row.
    idempotencyKey.current = null;
    if (touched[field]) setErrors((current) => ({ ...current, [field]: validateField(field, nextValues) }));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmissionError(null);
    const nextErrors = validate(values);
    setErrors(nextErrors);
    setTouched({ name: true, email: true, message: true });
    if (Object.keys(nextErrors).length > 0) {
      document.getElementById(`${formId}-${Object.keys(nextErrors)[0]}`)?.focus();
      return;
    }

    setSubmitting(true);
    try {
      if (onSubmit) {
        await onSubmit(values);
      } else {
        idempotencyKey.current ??= newId("lead-submit");
        await submitLead({
          kind: "contact",
          name: values.name,
          email: values.email,
          message: values.message,
          idempotencyKey: idempotencyKey.current,
        });
      }
      setSubmitted(true);
    } catch {
      // Provider/network internals are intentionally not reflected into a public PII form.
      setSubmissionError(SUBMISSION_ERROR);
    } finally {
      setSubmitting(false);
    }
  };

  const reset = () => {
    idempotencyKey.current = null;
    setValues(initialValues);
    setErrors({});
    setTouched({});
    setSubmissionError(null);
    setSubmitted(false);
  };

  if (submitted) {
    return (
      <section className="form-success" role="status" aria-live="polite">
        <strong>Thanks — your request was sent.</strong>
        <p>Your request was accepted by the contact service.</p>
        <button type="button" className="ghost" onClick={reset}>
          Send another request
        </button>
      </section>
    );
  }

  return (
    <form className="validated-form" noValidate onSubmit={handleSubmit}>
      <Field
        id={`${formId}-name`}
        label="Name"
        value={values.name}
        error={errors.name}
        required
        disabled={submitting}
        maxLength={120}
        onBlur={() => {
          setTouched((current) => ({ ...current, name: true }));
          setErrors((current) => ({ ...current, name: validateField("name", values) }));
        }}
        onChange={(value) => updateField("name", value)}
      />
      <Field
        id={`${formId}-email`}
        label="Email"
        type="email"
        value={values.email}
        error={errors.email}
        required
        disabled={submitting}
        maxLength={254}
        onBlur={() => {
          setTouched((current) => ({ ...current, email: true }));
          setErrors((current) => ({ ...current, email: validateField("email", values) }));
        }}
        onChange={(value) => updateField("email", value)}
      />
      <Field
        id={`${formId}-message`}
        label="How can we help?"
        value={values.message}
        error={errors.message}
        required
        multiline
        disabled={submitting}
        maxLength={4_000}
        onBlur={() => {
          setTouched((current) => ({ ...current, message: true }));
          setErrors((current) => ({ ...current, message: validateField("message", values) }));
        }}
        onChange={(value) => updateField("message", value)}
      />
      {submissionError && (
        <p className="field-error" role="alert" aria-live="assertive">
          {submissionError}
        </p>
      )}
      <button className="primary form-submit" type="submit" disabled={submitting}>
        {submitting ? "Sending…" : "Send request"}
      </button>
    </form>
  );
}

function Field({
  id,
  label,
  type = "text",
  value,
  error,
  required,
  multiline,
  disabled,
  maxLength,
  onBlur,
  onChange,
}: {
  id: string;
  label: string;
  type?: string;
  value: string;
  error?: string;
  required?: boolean;
  multiline?: boolean;
  disabled?: boolean;
  maxLength?: number;
  onBlur: () => void;
  onChange: (value: string) => void;
}) {
  const errorId = `${id}-error`;
  const props = {
    id,
    name: id,
    value,
    required,
    disabled,
    maxLength,
    onBlur,
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(event.target.value),
    "aria-invalid": Boolean(error),
    "aria-describedby": error ? errorId : undefined,
  };

  return (
    <label className={`form-field ${error ? "has-error" : ""}`} htmlFor={id}>
      <span>
        {label}
        {required ? " *" : ""}
      </span>
      {multiline ? <textarea {...props} rows={4} /> : <input {...props} type={type} />}
      {error && (
        <small id={errorId} className="field-error" role="alert">
          {error}
        </small>
      )}
    </label>
  );
}
