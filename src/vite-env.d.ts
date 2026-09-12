/// <reference types="vite/client" />

interface Window {
  studioShell?: {
    broadcastMidi: (data: number[]) => void;
    platform: string;
  };
}

interface MIDIMessageEvent extends Event {
  readonly data: Uint8Array;
}

interface MIDIInput {
  readonly id: string;
  readonly manufacturer: string | null;
  readonly name: string | null;
  readonly state: "connected" | "disconnected";
  onmidimessage: ((event: MIDIMessageEvent) => void) | null;
  open: () => Promise<MIDIInput>;
}

interface MIDIAccess extends EventTarget {
  readonly inputs: Map<string, MIDIInput>;
  onstatechange: ((event: Event) => void) | null;
}

interface Navigator {
  requestMIDIAccess?: (options?: { sysex?: boolean }) => Promise<MIDIAccess>;
}
