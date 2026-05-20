import { Logger } from 'pino';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

export const retrieveEnvVariable = (variableName: string, logger: Logger) => {
  const variable = process.env[variableName] || '';
  if (!variable) {
    console.log(`${variableName} is not set`);
    process.exit(1);
  }
  return variable;
};

/** Returns defaultValue when env is empty, whitespace, or "unset"/"none". */
export const retrieveOptionalEnvNumber = (
  variableName: string,
  defaultValue: number
): number => {
  const raw = (process.env[variableName] ?? '').trim();
  if (!raw || ['unset', 'none', 'infinity', 'inf'].includes(raw.toLowerCase())) {
    return defaultValue;
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    console.log(`${variableName} is not a valid number: "${raw}"`);
    process.exit(1);
  }
  return value;
};

export const strToArr = (str: string) => {
  const validJsonString = str.replace(/'/g, '"');
  const arr = JSON.parse(validJsonString);
  return arr
}


// Define the type for the JSON file content
export interface Data {
  privateKey: string;
  pubkey: string;
}


export const randVal = (min: number, max: number, count: number, total: number, isEven: boolean): number[] => {

  const arr: number[] = Array(count).fill(total / count);
  if (isEven) return arr

  if (max * count < total)
    throw new Error("Invalid input: max * count must be greater than or equal to total.")
  if (min * count > total)
    throw new Error("Invalid input: min * count must be less than or equal to total.")
  const average = total / count
  // Randomize pairs of elements
  for (let i = 0; i < count; i += 2) {
    // Generate a random adjustment within the range
    const adjustment = Math.random() * Math.min(max - average, average - min)
    // Add adjustment to one element and subtract from the other
    arr[i] += adjustment
    arr[i + 1] -= adjustment
  }
  // if (count % 2) arr.pop()
  return arr;
}


export const saveToJSONFile = (data: object, filePath: string = 'data.json'): boolean => {
  // Convert data object to JSON string
  const jsonData = JSON.stringify(data, null, 2);  // The `null, 2` argument formats the JSON with indentation
  fs.writeFileSync(filePath, jsonData, 'utf8');
  console.log('Data saved to JSON file.');
  return true;
};

export const sleep = async (ms: number) => {
  await new Promise((resolve) => setTimeout(resolve, ms))
}


export function deleteConsoleLines(numLines: number) {
  for (let i = 0; i < numLines; i++) {
    process.stdout.moveCursor(0, -1); // Move cursor up one line
    process.stdout.clearLine(-1);        // Clear the line
  }
}


// Function to read JSON file
export function readJson(filename: string = "data.json"): Data[] {
  if (!fs.existsSync(filename)) {
    // If the file does not exist, create an empty array
    fs.writeFileSync(filename, '[]', 'utf-8');
  }
  const data = fs.readFileSync(filename, 'utf-8');
  return JSON.parse(data) as Data[];
}

// Function to write JSON file
export function writeJson(data: Data[], filename: string = "data.json",): void {
  fs.writeFileSync(filename, JSON.stringify(data, null, 4), 'utf-8');
}

// Function to edit JSON file content
export function editJson(newData: Partial<Data>, filename: string = "data.json"): void {
  if (!newData.pubkey) {
    console.log("Pubkey is not prvided as an argument")
    return
  }
  const wallets = readJson(filename);
  const index = wallets.findIndex(wallet => wallet.pubkey === newData.pubkey);
  if (index !== -1) {
    wallets[index] = { ...wallets[index], ...newData };
    writeJson(wallets, filename);
  } else {
    console.error(`Pubkey ${newData.pubkey} does not exist.`);
  }
}

