"use client";

const STYLE_OPTIONS = [
  "minimal",
  "bold",
  "playful",
  "corporate",
  "luxury",
  "vintage",
  "modern",
  "elegant",
  "creative",
  "professional",
];

interface StyleKeywordPickerProps {
  value: string[];
  onChange: (keywords: string[]) => void;
}

export function StyleKeywordPicker({ value, onChange }: StyleKeywordPickerProps) {
  return (
    <div>
      <label className="text-sm font-medium">
        Choose your brand style
      </label>
      <p className="text-xs text-muted-foreground mt-1 mb-3">
        Select keywords that describe your visual identity
      </p>
      <div className="flex flex-wrap gap-2">
        {STYLE_OPTIONS.map((keyword) => (
          <button
            key={keyword}
            onClick={() => {
              const keywords = value.includes(keyword)
                ? value.filter((k) => k !== keyword)
                : [...value, keyword];
              onChange(keywords);
            }}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors border ${
              value.includes(keyword)
                ? "bg-accent text-accent-foreground border-accent"
                : "bg-transparent text-foreground border-border hover:border-muted-foreground"
            }`}
          >
            {keyword}
          </button>
        ))}
      </div>
    </div>
  );
}
