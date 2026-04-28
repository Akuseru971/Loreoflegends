import { VideoCreateForm } from "@/components/forms";

export default function NewVideoPage() {
  return (
    <section className="space-y-8">
      <div>
        <p className="eyebrow">New render job</p>
        <h1 className="mt-3 text-4xl font-semibold text-white">Create a League short</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-400">
          Choose the creative target and voice IDs. The pipeline will generate an idea, split
          Lamb/Wolf lines, synthesize each line separately, select web imagery, and render a
          vertical MP4.
        </p>
      </div>
      <VideoCreateForm />
    </section>
  );
}
