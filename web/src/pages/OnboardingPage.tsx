import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { onboard, type PiiData } from "../api/client";
import { ErrorMessage } from "../components/ErrorMessage";

const STEPS = ["Personal Info", "Address", "Contact & Identity", "Review"];

/** Auto-format SSN as ***-**-**** while typing */
function formatSSN(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 9);
  if (digits.length <= 3) return digits;
  if (digits.length <= 5) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
}

/** Auto-format phone as (555) 123-4567 while typing */
function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 10);
  if (digits.length === 0) return "";
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

/** Strip numbers from a string (for name/city fields) */
function stripNumbers(value: string): string {
  return value.replace(/[0-9]/g, "");
}

/** Strip formatting to get raw digits for the API */
function stripToDigits(value: string): string {
  return value.replace(/\D/g, "");
}

/** Format postal code as 5 digits */
function formatPostalCode(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, 5);
}

interface FieldErrors {
  givenName?: string;
  familyName?: string;
  dateOfBirth?: string;
  streetAddress?: string;
  locality?: string;
  region?: string;
  postalCode?: string;
  phoneNumber?: string;
  ssn?: string;
}

export function OnboardingPage() {
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [loading, setLoading] = useState(false);
  const { user, setUser } = useAuth();
  const navigate = useNavigate();

  const [formData, setFormData] = useState<PiiData>({
    givenName: "",
    familyName: "",
    dateOfBirth: "",
    email: user?.email || "",
    phoneNumber: "",
    streetAddress: "",
    locality: "",
    region: "",
    postalCode: "",
    ssn: "",
  });

  // Display values with formatting
  const [displayPhone, setDisplayPhone] = useState("");
  const [displaySSN, setDisplaySSN] = useState("");
  const [showSSN, setShowSSN] = useState(false);

  function updateField(field: keyof PiiData, value: string) {
    setFormData((prev) => ({ ...prev, [field]: value }));
    // Clear field error on change
    if (field in fieldErrors) {
      setFieldErrors((prev) => ({ ...prev, [field]: undefined }));
    }
  }

  function handlePhoneChange(value: string) {
    const digits = stripToDigits(value).slice(0, 10);
    const formatted = formatPhone(digits);
    setDisplayPhone(formatted);
    updateField("phoneNumber", digits);
  }

  function handleSSNChange(value: string) {
    const formatted = formatSSN(value);
    setDisplaySSN(formatted);
    // Store with hyphens for the API
    updateField("ssn", formatted);
  }

  function handlePostalCodeChange(value: string) {
    updateField("postalCode", formatPostalCode(value));
  }

  function handleNameField(field: "givenName" | "familyName", value: string) {
    updateField(field, stripNumbers(value));
  }

  function handleCityChange(value: string) {
    updateField("locality", stripNumbers(value));
  }

  /** Validate fields for the current step. Returns true if valid. */
  function validateStep(): boolean {
    const errors: FieldErrors = {};

    if (step === 0) {
      if (!formData.givenName.trim() || formData.givenName.trim().length < 2) {
        errors.givenName = "First name must be at least 2 characters";
      }
      if (!formData.familyName.trim() || formData.familyName.trim().length < 2) {
        errors.familyName = "Last name must be at least 2 characters";
      }
      if (!formData.dateOfBirth) {
        errors.dateOfBirth = "Date of birth is required";
      } else {
        const [y, m, d] = formData.dateOfBirth.split("-").map(Number);
        const dob = new Date(y, m - 1, d);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        if (dob >= today) {
          errors.dateOfBirth = "Date of birth must be in the past";
        }
      }
    }

    if (step === 1) {
      if (!formData.streetAddress.trim()) {
        errors.streetAddress = "Street address is required";
      }
      if (!formData.locality.trim()) {
        errors.locality = "City is required";
      }
      if (!formData.region.trim()) {
        errors.region = "State is required";
      } else if (formData.region.trim().length !== 2) {
        errors.region = "Use 2-letter state code (e.g., CA)";
      }
      if (!formData.postalCode.trim()) {
        errors.postalCode = "Postal code is required";
      } else if (formData.postalCode.length !== 5) {
        errors.postalCode = "Postal code must be 5 digits";
      }
    }

    if (step === 2) {
      const phoneDigits = stripToDigits(formData.phoneNumber ?? "");
      if (phoneDigits && phoneDigits.length !== 10) {
        errors.phoneNumber = "Phone number must be 10 digits";
      }
      const ssnDigits = stripToDigits(formData.ssn ?? "");
      if (!ssnDigits) {
        errors.ssn = "SSN is required";
      } else if (ssnDigits.length !== 9) {
        errors.ssn = "SSN must be 9 digits";
      }
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  function nextStep() {
    if (!validateStep()) return;
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  function prevStep() {
    setFieldErrors({});
    setStep((s) => Math.max(s - 1, 0));
  }

  async function handleSubmit() {
    setError(null);
    setLoading(true);

    try {
      // Strip phone to just digits for the API
      const submitData = {
        ...formData,
        phoneNumber: formData.phoneNumber ? stripToDigits(formData.phoneNumber) : undefined,
        region: formData.region.toUpperCase(),
      };
      const result = await onboard(submitData);
      // Store the refreshed token (now includes accountHolderId)
      localStorage.setItem("auth_token", result.token);
      setUser(result.user);
      navigate("/");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Onboarding failed"
      );
    } finally {
      setLoading(false);
    }
  }

  const inputClass =
    "mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500";
  const inputErrorClass =
    "mt-1 block w-full rounded-md border border-red-300 px-3 py-2 text-sm shadow-sm focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500";

  function fieldClass(field: keyof FieldErrors) {
    return fieldErrors[field] ? inputErrorClass : inputClass;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-lg">
        <div className="rounded-lg border border-gray-200 bg-white p-8 shadow-sm">
          <h1 className="mb-2 text-center text-2xl font-semibold text-gray-900">
            Complete Your Profile
          </h1>
          <p className="mb-6 text-center text-sm text-gray-500">
            We need some information to set up your account
          </p>

          {/* Progress indicator */}
          <div className="mb-8 flex items-center justify-between">
            {STEPS.map((label, i) => (
              <div key={label} className="flex items-center">
                <div
                  className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium ${
                    i <= step
                      ? "bg-indigo-600 text-white"
                      : "bg-gray-200 text-gray-500"
                  }`}
                >
                  {i + 1}
                </div>
                {i < STEPS.length - 1 && (
                  <div
                    className={`mx-1 h-0.5 w-8 sm:w-12 ${
                      i < step ? "bg-indigo-600" : "bg-gray-200"
                    }`}
                  />
                )}
              </div>
            ))}
          </div>
          <p className="mb-4 text-center text-sm font-medium text-gray-700">
            {STEPS[step]}
          </p>

          {error && (
            <div className="mb-4">
              <ErrorMessage message={error} />
            </div>
          )}

          <form onSubmit={(e) => e.preventDefault()} onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }}>
            {/* Step 1: Personal Info */}
            {step === 0 && (
              <div className="space-y-4">
                <div>
                  <label htmlFor="onboard-given-name" className="block text-sm font-medium text-gray-700">
                    First Name *
                  </label>
                  <input
                    id="onboard-given-name"
                    type="text"
                    required
                    value={formData.givenName}
                    onChange={(e) => handleNameField("givenName", e.target.value)}
                    className={fieldClass("givenName")}
                    placeholder="Jane"
                  />
                  {fieldErrors.givenName && (
                    <p className="mt-1 text-xs text-red-600">{fieldErrors.givenName}</p>
                  )}
                </div>
                <div>
                  <label htmlFor="onboard-family-name" className="block text-sm font-medium text-gray-700">
                    Last Name *
                  </label>
                  <input
                    id="onboard-family-name"
                    type="text"
                    required
                    value={formData.familyName}
                    onChange={(e) => handleNameField("familyName", e.target.value)}
                    className={fieldClass("familyName")}
                    placeholder="Doe"
                  />
                  {fieldErrors.familyName && (
                    <p className="mt-1 text-xs text-red-600">{fieldErrors.familyName}</p>
                  )}
                </div>
                <div>
                  <label htmlFor="onboard-dob" className="block text-sm font-medium text-gray-700">
                    Date of Birth *
                  </label>
                  <input
                    id="onboard-dob"
                    type="date"
                    required
                    min="1900-01-01"
                    max={new Date().toISOString().split("T")[0]}
                    value={formData.dateOfBirth}
                    onChange={(e) => updateField("dateOfBirth", e.target.value)}
                    className={fieldClass("dateOfBirth")}
                  />
                  {fieldErrors.dateOfBirth && (
                    <p className="mt-1 text-xs text-red-600">{fieldErrors.dateOfBirth}</p>
                  )}
                </div>
              </div>
            )}

            {/* Step 2: Address */}
            {step === 1 && (
              <div className="space-y-4">
                <div>
                  <label htmlFor="onboard-street" className="block text-sm font-medium text-gray-700">
                    Street Address *
                  </label>
                  <input
                    id="onboard-street"
                    type="text"
                    required
                    value={formData.streetAddress}
                    onChange={(e) => updateField("streetAddress", e.target.value)}
                    className={fieldClass("streetAddress")}
                    placeholder="123 Main St"
                  />
                  {fieldErrors.streetAddress && (
                    <p className="mt-1 text-xs text-red-600">{fieldErrors.streetAddress}</p>
                  )}
                </div>
                <div>
                  <label htmlFor="onboard-city" className="block text-sm font-medium text-gray-700">
                    City *
                  </label>
                  <input
                    id="onboard-city"
                    type="text"
                    required
                    value={formData.locality}
                    onChange={(e) => handleCityChange(e.target.value)}
                    className={fieldClass("locality")}
                    placeholder="San Francisco"
                  />
                  {fieldErrors.locality && (
                    <p className="mt-1 text-xs text-red-600">{fieldErrors.locality}</p>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="onboard-region" className="block text-sm font-medium text-gray-700">
                      State *
                    </label>
                    <input
                      id="onboard-region"
                      type="text"
                      required
                      maxLength={2}
                      value={formData.region}
                      onChange={(e) => updateField("region", e.target.value.replace(/[^a-zA-Z]/g, "").toUpperCase())}
                      className={fieldClass("region")}
                      placeholder="CA"
                    />
                    {fieldErrors.region && (
                      <p className="mt-1 text-xs text-red-600">{fieldErrors.region}</p>
                    )}
                  </div>
                  <div>
                    <label htmlFor="onboard-postal" className="block text-sm font-medium text-gray-700">
                      Postal Code *
                    </label>
                    <input
                      id="onboard-postal"
                      type="text"
                      required
                      maxLength={5}
                      value={formData.postalCode}
                      onChange={(e) => handlePostalCodeChange(e.target.value)}
                      className={fieldClass("postalCode")}
                      placeholder="94105"
                    />
                    {fieldErrors.postalCode && (
                      <p className="mt-1 text-xs text-red-600">{fieldErrors.postalCode}</p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Step 3: Contact & Identity */}
            {step === 2 && (
              <div className="space-y-4">
                <div>
                  <label htmlFor="onboard-email" className="block text-sm font-medium text-gray-700">
                    Email
                  </label>
                  <input
                    id="onboard-email"
                    type="email"
                    value={formData.email}
                    disabled
                    className="mt-1 block w-full rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-500 shadow-sm"
                  />
                  <p className="mt-1 text-xs text-gray-400">
                    Email from your account cannot be changed here
                  </p>
                </div>
                <div>
                  <label htmlFor="onboard-phone" className="block text-sm font-medium text-gray-700">
                    Phone Number
                  </label>
                  <input
                    id="onboard-phone"
                    type="tel"
                    value={displayPhone}
                    onChange={(e) => handlePhoneChange(e.target.value)}
                    placeholder="(555) 123-4567"
                    className={fieldClass("phoneNumber")}
                  />
                  {fieldErrors.phoneNumber && (
                    <p className="mt-1 text-xs text-red-600">{fieldErrors.phoneNumber}</p>
                  )}
                </div>
                <div>
                  <label htmlFor="onboard-ssn" className="block text-sm font-medium text-gray-700">
                    Social Security Number *
                  </label>
                  <div className="relative">
                    <input
                      id="onboard-ssn"
                      type={showSSN ? "text" : "password"}
                      required
                      value={displaySSN}
                      onChange={(e) => handleSSNChange(e.target.value)}
                      placeholder="***-**-****"
                      maxLength={11}
                      className={fieldClass("ssn")}
                    />
                    <button
                      type="button"
                      onClick={() => setShowSSN(!showSSN)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-500 hover:text-gray-700"
                    >
                      {showSSN ? "Hide" : "Show"}
                    </button>
                  </div>
                  {fieldErrors.ssn && (
                    <p className="mt-1 text-xs text-red-600">{fieldErrors.ssn}</p>
                  )}
                  <p className="mt-1 text-xs text-gray-400">
                    Required for identity verification
                  </p>
                </div>
              </div>
            )}

            {/* Step 4: Review */}
            {step === 3 && (
              <div className="space-y-3 text-sm">
                <div className="rounded-md bg-gray-50 p-4">
                  <h3 className="mb-2 font-medium text-gray-900">
                    Personal Info
                  </h3>
                  <p className="text-gray-600">
                    {formData.givenName} {formData.familyName}
                  </p>
                  <p className="text-gray-600">
                    Born: {formData.dateOfBirth}
                  </p>
                </div>
                <div className="rounded-md bg-gray-50 p-4">
                  <h3 className="mb-2 font-medium text-gray-900">Address</h3>
                  <p className="text-gray-600">{formData.streetAddress}</p>
                  <p className="text-gray-600">
                    {formData.locality}, {formData.region}{" "}
                    {formData.postalCode}
                  </p>
                </div>
                <div className="rounded-md bg-gray-50 p-4">
                  <h3 className="mb-2 font-medium text-gray-900">Contact</h3>
                  <p className="text-gray-600">{formData.email}</p>
                  {displayPhone && (
                    <p className="text-gray-600">{displayPhone}</p>
                  )}
                  <p className="text-gray-600">SSN: ***-**-{stripToDigits(formData.ssn ?? "").slice(-4)}</p>
                </div>
              </div>
            )}

            {/* Navigation buttons */}
            <div className="mt-6 flex justify-between">
              {step > 0 ? (
                <button
                  type="button"
                  onClick={prevStep}
                  className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  Back
                </button>
              ) : (
                <div />
              )}

              {step < STEPS.length - 1 ? (
                <button
                  type="button"
                  onClick={nextStep}
                  className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
                >
                  Next
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={loading}
                  className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {loading ? "Submitting..." : "Submit"}
                </button>
              )}
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
