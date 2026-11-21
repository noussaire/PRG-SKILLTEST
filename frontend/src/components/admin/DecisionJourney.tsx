"use client";

import { CheckCircle2, Compass, ArrowDown, HelpCircle, Award, Flag } from "lucide-react";

export interface DecisionStep {
  stepIndex: number;
  id: string;
  timestamp: string;
  node: {
    id: string;
    title: string;
    story: string;
    question: string | null;
    kind: "QUESTION" | "ENDING";
    isStart: boolean;
  };
  chosenOption: {
    id: string;
    position: number;
    label: string;
    nextNode: {
      id: string;
      title: string;
      story: string;
      kind: "QUESTION" | "ENDING";
    };
    impacts: Array<{
      indicator: number;
      competency: {
        id: string;
        slug: string;
        label: string;
      };
    }>;
  };
  alternativeOptions: Array<{
    id: string;
    position: number;
    label: string;
    impacts: Array<{
      indicator: number;
      competency: {
        id: string;
        slug: string;
        label: string;
      };
    }>;
  }>;
}

interface DecisionJourneyProps {
  decisions: DecisionStep[];
  currentOrFinalNode?: {
    id: string;
    title: string;
    story: string;
    kind: "QUESTION" | "ENDING";
  } | null;
  attemptStatus: "IN_PROGRESS" | "COMPLETED";
}

export function DecisionJourney({
  decisions,
  currentOrFinalNode,
  attemptStatus,
}: DecisionJourneyProps) {
  if (decisions.length === 0) {
    return (
      <div className="bg-white p-8 rounded-2xl border border-slate-200/80 text-center">
        <Compass className="w-10 h-10 text-slate-300 mx-auto mb-3" />
        <h4 className="text-sm font-bold text-brand-blue-950">Aucune décision enregistrée</h4>
        <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
          Ce participant a accédé au parcours mais n'a pas encore validé son premier choix de décision.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8 relative">
      {decisions.map((step) => (
        <div key={step.id} className="relative">
          {/* Main Card for Step */}
          <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">
            {/* Step Header */}
            <div className="bg-brand-blue-950 text-white px-5 py-3.5 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className="w-6 h-6 rounded-lg bg-brand-blue-700 text-white flex items-center justify-center text-xs font-black shadow-sm">
                  {step.stepIndex}
                </span>
                <span className="font-bold text-sm tracking-tight">{step.node.title}</span>
                {step.node.isStart && (
                  <span className="text-[10px] bg-white/10 text-slate-300 px-2 py-0.5 rounded-full font-semibold uppercase tracking-wider">
                    Situation initiale
                  </span>
                )}
              </div>
              <span className="text-[11px] text-slate-400 font-medium">
                {new Date(step.timestamp).toLocaleTimeString("fr-FR", {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })}
              </span>
            </div>

            {/* Step Body */}
            <div className="p-6 space-y-5">
              {/* Story & Question */}
              <div className="space-y-2">
                <p className="text-xs text-slate-600 leading-relaxed bg-canvas p-3.5 rounded-xl border border-slate-100">
                  {step.node.story}
                </p>
                {step.node.question && (
                  <div className="flex items-center gap-2 text-xs font-bold text-brand-blue-950 pt-1">
                    <HelpCircle className="w-4 h-4 text-brand-blue-700" />
                    <span>{step.node.question}</span>
                  </div>
                )}
              </div>

              {/* Chosen Option (Highlighted) */}
              <div className="rounded-xl border-2 border-brand-blue-700 bg-brand-blue-50/40 p-4 relative">
                <div className="flex items-center justify-between mb-2">
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-brand-blue-700 uppercase tracking-wider">
                    <CheckCircle2 className="w-4 h-4 text-brand-blue-700" />
                    Choix validé par le participant
                  </span>
                </div>
                <div className="text-sm font-semibold text-brand-blue-950">
                  « {step.chosenOption.label} »
                </div>

                {/* Impact Pills */}
                {step.chosenOption.impacts.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-brand-blue-100 flex flex-wrap gap-2 items-center">
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1">
                      <Award className="w-3 h-3 text-brand-blue-700" />
                      Indicateurs comportementaux :
                    </span>
                    {step.chosenOption.impacts.map((imp) => {
                      const isPositive = imp.indicator > 0;
                      return (
                        <span
                          key={imp.competency.id}
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold ${
                            isPositive
                              ? "bg-brand-green-100/80 text-brand-green-800 border border-brand-green-300"
                              : "bg-amber-100/80 text-amber-800 border border-amber-300"
                          }`}
                        >
                          {imp.competency.label} ({isPositive ? `+${imp.indicator}` : imp.indicator})
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Alternative Options (Unchosen) */}
              {step.alternativeOptions.length > 0 && (
                <div className="space-y-2 pt-1">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    Options alternatives non retenues ({step.alternativeOptions.length}) :
                  </div>
                  <div className="space-y-1.5">
                    {step.alternativeOptions.map((alt) => (
                      <div
                        key={alt.id}
                        className="p-3 rounded-xl border border-slate-200/60 bg-white text-xs text-slate-500 flex items-center justify-between"
                      >
                        <span className="line-through decoration-slate-300">{alt.label}</span>
                        {alt.impacts.length > 0 && (
                          <div className="flex gap-1 shrink-0 ml-2">
                            {alt.impacts.map((imp) => (
                              <span
                                key={imp.competency.id}
                                className="text-[9px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-400 font-medium"
                              >
                                {imp.competency.label} ({imp.indicator > 0 ? `+${imp.indicator}` : imp.indicator})
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Connector Arrow */}
          <div className="flex justify-center my-3">
            <div className="w-8 h-8 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-400 shadow-sm">
              <ArrowDown className="w-4 h-4" />
            </div>
          </div>
        </div>
      ))}

      {/* Final Outcome or Current State Card */}
      {currentOrFinalNode && (
        <div
          className={`rounded-2xl border p-6 shadow-sm ${
            attemptStatus === "COMPLETED"
              ? "bg-brand-blue-950 text-white border-slate-800"
              : "bg-white border-amber-200 text-brand-blue-950"
          }`}
        >
          <div className="flex items-center justify-between mb-3">
            <span
              className={`inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider px-3 py-1 rounded-full ${
                attemptStatus === "COMPLETED"
                  ? "bg-brand-green-500/20 text-brand-green-400 border border-brand-green-500/30"
                  : "bg-amber-100 text-amber-800 border border-amber-300"
              }`}
            >
              <Flag className="w-3.5 h-3.5" />
              {attemptStatus === "COMPLETED" ? "Conséquence finale atteinte" : "Étape en attente"}
            </span>
          </div>

          <h4 className="text-lg font-black tracking-tight mb-2">
            {currentOrFinalNode.title}
          </h4>
          <p
            className={`text-xs leading-relaxed ${
              attemptStatus === "COMPLETED" ? "text-slate-300" : "text-slate-600"
            }`}
          >
            {currentOrFinalNode.story}
          </p>
        </div>
      )}
    </div>
  );
}
