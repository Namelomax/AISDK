"use client";
import { useRouter } from "next/navigation";

export default function GoToPromtsButton() {
  const router = useRouter();

  return (
    <button
      onClick={() => router.push("/promts")}
      className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition"
    >
      Перейти к странице промтов
    </button>
  );
}
