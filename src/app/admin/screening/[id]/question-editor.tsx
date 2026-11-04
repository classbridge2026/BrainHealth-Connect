"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { dangerButtonClass, primaryButtonClass, secondaryButtonClass, textAreaClass, textInputClass } from "@/components/form-classes";
import { confirmAction, showOutcome } from "@/lib/ui/sweet-alert";
import { importQuestionFile, type EditorBand, type EditorQuestion, type EditorState } from "@/lib/screening/questions";
import { saveScreeningQuestionsAction } from "../actions";

function blankQuestion(): EditorQuestion {
  return {
    prompt: "",
    choices: [
      { value: "0", label: "" },
      { value: "1", label: "" },
    ],
    safety: false,
    safetyAtLeast: "",
  };
}

export function QuestionEditor({ toolId, initial }: { toolId: string; initial: EditorState }) {
  const router = useRouter();
  const [questions, setQuestions] = useState(initial.questions);
  const [bands, setBands] = useState(initial.bands);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function updateQuestion(index: number, next: EditorQuestion) {
    setQuestions((current) => current.map((question, position) => (position === index ? next : question)));
  }

  function save(clear: boolean) {
    setError("");
    setMessage("");
    startTransition(async () => {
      const result = await saveScreeningQuestionsAction({ toolId, clear, questions, bands });
      if (!result.ok) {
        setError(result.message);
        void showOutcome({ text: result.message, tone: "error" });
        return;
      }
      if (clear) {
        setQuestions([]);
        setBands([]);
      }
      const scoring = result.mode === "automatic"
        ? "No scoring bands were supplied, so the result is the sum of the answer values."
        : result.mode === "uploaded"
          ? "The uploaded scoring bands were stored."
          : "The questions were removed.";
      const saved = `Saved version ${result.version}. ${scoring} Patients still cannot start until clinical approval and the safety requirements are recorded.`;
      setMessage(saved);
      void showOutcome({ title: "Questions saved", text: saved, tone: "ok" });
      router.refresh();
    });
  }

  function uploadFile(file: File | undefined) {
    setError("");
    setMessage("");
    if (!file) return;
    if (file.size > 200_000) {
      const text = "The question file must be 200 KB or smaller.";
      setError(text);
      void showOutcome({ text, tone: "error" });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        const imported = importQuestionFile(parsed);
        if (!imported.ok) {
          setError(imported.message);
          void showOutcome({ text: imported.message, tone: "error" });
          return;
        }
        setQuestions(imported.state.questions);
        setBands(imported.state.bands);
        setMessage(imported.state.bands.length === 0
          ? "The file is ready. No scoring bands were found, so saving will total the answer values. Review the questions, then save."
          : "The file is ready. Review the questions and scoring bands, then save.");
      } catch {
        const text = "The file is not valid JSON.";
        setError(text);
        void showOutcome({ text, tone: "error" });
      }
    };
    reader.readAsText(file);
  }

  return (
    <section className="grid gap-4 rounded-2xl border border-brand-line bg-white p-5">
      <div className="grid gap-2">
        <h2 className="text-lg font-semibold text-brand-navy">Questions</h2>
        <p className="text-sm leading-6 text-brand-muted">
          Add, edit, or remove questions here, or upload a JSON file. Leave the scoring bands empty to store a numeric total. The total does not create mild, moderate, or severe labels.
        </p>
      </div>
      <label className="text-sm font-medium">
        Upload a question file
        <input
          className="mt-1 block w-full text-sm"
          accept="application/json,.json"
          type="file"
          onChange={(event) => {
            uploadFile(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
      </label>
      {questions.map((question, index) => (
        <fieldset key={index} className="grid gap-3 rounded-xl border border-brand-line p-4">
          <legend className="px-1 text-sm font-semibold text-brand-navy">Question {index + 1}</legend>
          <label className="text-sm font-medium">
            Prompt
            <textarea
              className={`${textAreaClass} mt-1 min-h-20`}
              value={question.prompt}
              onChange={(event) => updateQuestion(index, { ...question, prompt: event.target.value })}
            />
          </label>
          <div className="grid gap-2">
            {question.choices.map((choice, choiceIndex) => (
              <div key={choiceIndex} className="grid gap-2 sm:grid-cols-[6rem_1fr_auto]">
                <label className="text-sm font-medium">
                  Score
                  <input
                    className={`${textInputClass} mt-1`}
                    inputMode="numeric"
                    value={choice.value}
                    onChange={(event) => {
                      const choices = question.choices.map((entry, position) => position === choiceIndex ? { ...entry, value: event.target.value } : entry);
                      updateQuestion(index, { ...question, choices });
                    }}
                  />
                </label>
                <label className="text-sm font-medium">
                  Answer
                  <input
                    className={`${textInputClass} mt-1`}
                    value={choice.label}
                    onChange={(event) => {
                      const choices = question.choices.map((entry, position) => position === choiceIndex ? { ...entry, label: event.target.value } : entry);
                      updateQuestion(index, { ...question, choices });
                    }}
                  />
                </label>
                <button
                  className={`${secondaryButtonClass} self-end`}
                  type="button"
                  disabled={question.choices.length <= 2}
                  onClick={() => updateQuestion(index, { ...question, choices: question.choices.filter((_, position) => position !== choiceIndex) })}
                >
                  Remove answer
                </button>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              className={secondaryButtonClass}
              type="button"
              disabled={question.choices.length >= 8}
              onClick={() => updateQuestion(index, { ...question, choices: [...question.choices, { value: String(question.choices.length), label: "" }] })}
            >
              Add answer
            </button>
            <button
              className={secondaryButtonClass}
              type="button"
              disabled={index === 0}
              onClick={() => setQuestions((current) => {
                const next = [...current];
                [next[index - 1], next[index]] = [next[index], next[index - 1]];
                return next;
              })}
            >
              Move up
            </button>
            <button
              className={secondaryButtonClass}
              type="button"
              disabled={index === questions.length - 1}
              onClick={() => setQuestions((current) => {
                const next = [...current];
                [next[index], next[index + 1]] = [next[index + 1], next[index]];
                return next;
              })}
            >
              Move down
            </button>
            <button
              className={dangerButtonClass}
              type="button"
              onClick={() => setQuestions((current) => current.filter((_, position) => position !== index))}
            >
              Delete question
            </button>
          </div>
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={question.safety}
              onChange={(event) => updateQuestion(index, { ...question, safety: event.target.checked })}
            />
            Raise the safety flag for this question
          </label>
          {question.safety ? (
            <label className="text-sm font-medium">
              Flag when the answer score is at least
              <input
                className={`${textInputClass} mt-1 max-w-32`}
                inputMode="numeric"
                value={question.safetyAtLeast}
                onChange={(event) => updateQuestion(index, { ...question, safetyAtLeast: event.target.value })}
              />
            </label>
          ) : null}
        </fieldset>
      ))}
      <button className={secondaryButtonClass} type="button" onClick={() => setQuestions((current) => [...current, blankQuestion()])}>
        Add question
      </button>
      <div className="grid gap-3">
        <h3 className="text-base font-semibold text-brand-navy">Scoring bands</h3>
        <p className="text-sm leading-6 text-brand-muted">Optional. Empty bands store one result: the sum of the selected scores, labeled “Numeric total”.</p>
        {bands.map((band, index) => (
          <div key={index} className="grid gap-2 sm:grid-cols-[6rem_6rem_1fr_auto]">
            <label className="text-sm font-medium">
              From
              <input className={`${textInputClass} mt-1`} inputMode="numeric" value={band.min} onChange={(event) => setBands((current) => current.map((entry, position) => position === index ? { ...entry, min: event.target.value } : entry))} />
            </label>
            <label className="text-sm font-medium">
              To
              <input className={`${textInputClass} mt-1`} inputMode="numeric" value={band.max} onChange={(event) => setBands((current) => current.map((entry, position) => position === index ? { ...entry, max: event.target.value } : entry))} />
            </label>
            <label className="text-sm font-medium">
              Label
              <input className={`${textInputClass} mt-1`} value={band.label} onChange={(event) => setBands((current) => current.map((entry, position) => position === index ? { ...entry, label: event.target.value } : entry))} />
            </label>
            <button className={`${dangerButtonClass} self-end`} type="button" onClick={() => setBands((current) => current.filter((_, position) => position !== index))}>
              Remove band
            </button>
          </div>
        ))}
        <button
          className={secondaryButtonClass}
          type="button"
          onClick={() => setBands((current) => [...current, { min: "", max: "", label: "" } satisfies EditorBand])}
        >
          Add scoring band
        </button>
      </div>
      {error ? <p role="alert" className="text-sm text-brand-danger">{error}</p> : null}
      {message ? <p role="status" className="text-sm text-brand-teal">{message}</p> : null}
      <div className="flex flex-wrap gap-2">
        <button className={primaryButtonClass} type="button" disabled={pending || questions.length === 0} onClick={() => save(false)}>
          Save questions
        </button>
        <button
          className={dangerButtonClass}
          type="button"
          disabled={pending}
          onClick={() => {
            void confirmAction({
              title: "Remove every question?",
              text: "This clears the stored questions for this instrument.",
              confirmText: "Remove questions",
              danger: true,
            }).then((ok) => {
              if (ok) save(true);
            });
          }}
        >
          Remove all questions
        </button>
      </div>
    </section>
  );
}
