import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { FileUIPart } from 'ai';
import JSZip from 'jszip';
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
export async function convertBlobFilesToDataURLs(files: File[]): Promise<string[]> {
  const promises = files.map(
    (file) =>
      new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      })
  );
  return Promise.all(promises);
}

import mammoth from 'mammoth';
import * as XLSX from 'xlsx';

const decodeEntities = (input: string): string =>
  input
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

const binaryBufferToText = (buffer: ArrayBuffer): string => {
  const encodings = ['utf-8', 'windows-1251', 'windows-1252'];
  for (const encoding of encodings) {
    try {
      const decoder = new TextDecoder(encoding, { fatal: false });
      const raw = decoder.decode(new Uint8Array(buffer));
      const cleaned = raw
        .replace(/[\x00-\x09\x0B\x0C\x0E-\x1F]+/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim();
      if (cleaned) {
        return cleaned;
      }
    } catch (error) {
      // continue
    }
  }
  return '';
};

const extractFromPptx = async (buffer: ArrayBuffer): Promise<string> => {
  const zip = await JSZip.loadAsync(buffer);
  const slideFiles = Object.keys(zip.files)
    .filter((name) => name.startsWith('ppt/slides/slide') && name.endsWith('.xml'))
    .sort();

  let text = '';

  for (let index = 0; index < slideFiles.length; index++) {
    const slidePath = slideFiles[index];
    const xml = await zip.files[slidePath].async('string');
    const matches = Array.from(xml.matchAll(/<a:t[^>]*>(.*?)<\/a:t>/g));
    if (matches.length === 0) continue;

    const slideText = matches
      .map((match) => decodeEntities(match[1]).trim())
      .filter(Boolean)
      .join('\n');

    if (slideText) {
      text += `\n--- Slide ${index + 1} ---\n${slideText}\n`;
    }
  }

  return text.trim();
};

export async function extractTextFromFileUIPart(file: FileUIPart): Promise<string> {
  const res = await fetch(file.url);
  const blob = await res.blob();
  const buffer = await blob.arrayBuffer();
  const mimeType = file.mediaType;

  try {
    // ----- DOCX -----
    if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
      const result = await mammoth.extractRawText({ arrayBuffer: buffer });
      return result.value;
    }

    if (mimeType === 'application/msword') {
      try {
        const result = await mammoth.extractRawText({ arrayBuffer: buffer });
        if (result.value?.trim()) {
          return result.value;
        }
      } catch (error) {
        // fall back to binary extraction below
      }
      return binaryBufferToText(buffer);
    }

    // ----- XLSX -----
    if (
      mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      mimeType === 'application/vnd.ms-excel'
    ) {
      const workbook = XLSX.read(buffer, { type: "array" });
      let text = "";

      workbook.SheetNames.forEach((sheetName) => {
        const sheet = workbook.Sheets[sheetName];
        text += `\n--- Sheet: ${sheetName} ---\n`;
        text += XLSX.utils.sheet_to_txt(sheet);
      });

      return text;
    }

    // ----- PPTX -----
    if (mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') {
      return await extractFromPptx(buffer);
    }

    if (mimeType === 'application/vnd.ms-powerpoint') {
      return binaryBufferToText(buffer);
    }

    // ----- Plain text -----
    if (mimeType.startsWith("text/")) {
      return await blob.text();
    }

    return "";
  } catch (e) {
    console.error("Error parsing file:", e);
    throw new Error(`Failed to parse ${file.url}`);
  }
}


export function isTextExtractable(mimeType: string): boolean {
  return [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.ms-powerpoint',
    'text/plain',
    'text/markdown',
    'text/csv',
  ].includes(mimeType);
}