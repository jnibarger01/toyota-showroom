"use client";

import { FormEvent, useId, useState, type ChangeEvent } from "react";

type FormValues = {
  name: string;
  email: string;
  message: string;
};

type FormErrors = Partial<Record<keyof FormValues, string>>;

type Props = {
  onSubmit?: (values: FormValues) => Promise<void> | void;
};

const initialValues: FormValues = { name: "", email: "", message: "" };

function validate(values: FormValues): FormErrors {
  const errors: FormErrors = {};
  if (!values.name.trim()) errors.name = "Enter your name so we know who to contact.";
  if (!values.email.trim()) errors.email = "Enter an email address for your reply.";
  else if (!/^\S+@\S+\.\S+$/.test(values.email)) errors.email = "Use an email address like you@example.com.";
  if (!values.message.trim()) errors.message = "Tell us what you would like help with.";
  return errors;
}

function validateField(field: keyof FormValues, values: FormValues): string | undefined {
  return validate(values)[field];
}

export function ValidatedLeadForm({ onSubmit }: Props) {
  const formId = useId();
  const [values, setValues] = useState(initialValues);
  const [errors, setErrors] = useState<FormErrors>({});
  const [touched, setTouched] = useState<Partial<Record<keyof FormValues, boolean>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const updateField = (field: keyof FormValues, value: string) => {
    const nextValues = { ...values, [field]: value };
    setValues(nextValues);
    if (touched[field]) setErrors((current) => ({ ...current, [field]: validateField(field, nextValues) }));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextErrors = validate(values);
    setErrors(nextErrors);
    setTouched({ name: true, email: true, message: true });
    if (Object.keys(nextErrors).length > 0) {
      document.getElementById(`${formId}-${Object.keys(nextErrors)[0]}`)?.focus();
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit?.(values);
      setSubmitted(true);
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <section className="form-success" role="status" aria-live="polite">
        <strong>Thanks — your request was sent.</strong>
        <p>We’ll get back to you using the email address you provided.</p>
        <button type="button" className="ghost" onClick={() => setSubmitted(false)}>
          Send another request
        </button>
      </section>
    );
  }

  return (
    <form className="validated-form" noValidate onSubmit={handleSubmit}>
      <Field id={`${formId}-name`} label="Name" value={values.name} error={errors.name} required
        onBlur={() => { setTouched((current) => ({ ...current, name: true })); setErrors((current) => ({ ...current, name: validateField("name", values) })); }}
        onChange={(value) => updateField("name", value)} />
      <Field id={`${formId}-email`} label="Email" type="email" value={values.email} error={errors.email} required
        onBlur={() => { setTouched((current) => ({ ...current, email: true })); setErrors((current) => ({ ...current, email: validateField("email", values) })); }}
        onChange={(value) => updateField("email", value)} />
      <Field id={`${formId}-message`} label="How can we help?" value={values.message} error={errors.message} required multiline
        onBlur={() => { setTouched((current) => ({ ...current, message: true })); setErrors((current) => ({ ...current, message: validateField("message", values) })); }}
        onChange={(value) => updateField("message", value)} />
      <button className="primary form-submit" type="submit" disabled={submitting}>
        {submitting ? "Sending…" : "Send request"}
      </button>
    </form>
  );
}

function Field({ id, label, type = "text", value, error, required, multiline, onBlur, onChange }: {
  id: string; label: string; type?: string; value: string; error?: string; required?: boolean;
  multiline?: boolean; onBlur: () => void; onChange: (value: string) => void;
}) {
  const errorId = `${id}-error`;
  const props = { id, name: id, value, required, onBlur, onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(event.target.value), "aria-invalid": Boolean(error), "aria-describedby": error ? errorId : undefined };
  return <label className={`form-field ${error ? "has-error" : ""}`} htmlFor={id}>
    <span>{label}{required ? " *" : ""}</span>
    {multiline ? <textarea {...props} rows={4} /> : <input {...props} type={type} />}
    {error && <small id={errorId} className="field-error" role="alert">{error}</small>}
  </label>;
}
