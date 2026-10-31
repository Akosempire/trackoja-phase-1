import { Dialog } from '../ui/Dialog';
import { SHORTCUTS } from '../../utils/register';

export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} title="Keyboard shortcuts" description="Serve a customer without touching the mouse. A USB scanner works from anywhere on this screen.">
      <table className="w-full text-sm">
        <tbody className="divide-y divide-line">
          {SHORTCUTS.map((s) => (
            <tr key={s.keys}>
              <td className="py-2 pr-4 align-top"><kbd className="whitespace-nowrap rounded-md border border-line-strong bg-subtle px-1.5 py-0.5 font-mono text-[12px] text-ink">{s.keys}</kbd></td>
              <td className="py-2 text-ink-2">{s.action}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Dialog>
  );
}
