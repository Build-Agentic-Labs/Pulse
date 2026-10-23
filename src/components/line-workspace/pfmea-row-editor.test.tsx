import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { PfmeaRowEditor } from './pfmea-row-editor';
import { createPfmeaRowForProcedureLink } from '@/domain/pfmea';
import { loadWorkspaceMembersFromSupabase } from '@/domain/supabase-planner';
import type { Task } from '@/domain/types';
vi.mock('@/domain/supabase-planner', () => ({ loadWorkspaceMembersFromSupabase: vi.fn() }));
function row() {
 return { ...createPfmeaRowForProcedureLink({ id:'t', name:'Task', wbs:'1' } as Task, undefined), failureMode:'Loose', effect:'Leak', severity:6, cause:'Missed torque', occurrence:3, currentControls:'Torque standard', detection:2, detectionActivity:'Leak test', recommendedActions:'Add check', actionOwner:'Existing owner', targetDate:'2026-10-23', actionsTaken:'Check implemented', resultOccurrence:2, resultDetection:1, verificationNotes:'Test run passed' };
}
it('keeps edits local until Save and requires verification to close an action', async () => {
  vi.mocked(loadWorkspaceMembersFromSupabase).mockResolvedValue([{ userId:'member', fullName:'Test Member', email:'test@example.test', workspaceId:'w', role:'editor', createdAt:'' }]);
  const onSave = vi.fn(); const original = row(); const before = structuredClone(original);
  render(<PfmeaRowEditor row={original} workspaceId="w" readOnly={false} onSave={onSave} onCancel={vi.fn()} />);
  await waitFor(() => expect(screen.getByLabelText('Action owner')).toBeEnabled());
  fireEvent.change(screen.getByLabelText('Action owner'), { target:{ value:'member' } });
  fireEvent.change(screen.getByLabelText('Action status'), { target:{ value:'closed' } });
  expect(screen.getByRole('button',{name:'Save risk'})).toBeDisabled();
  expect(onSave).not.toHaveBeenCalled(); expect(original).toEqual(before);
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button',{name:'Save risk'}));
  expect(onSave.mock.calls[0][0]).toMatchObject({ actionStatus:'closed', actionOwnerId:'member', actionOwner:'Test Member', verifiedAt:expect.any(String) });
});
it('preserves an existing owner when the directory fails and cannot close incomplete actions', async () => {
  vi.mocked(loadWorkspaceMembersFromSupabase).mockRejectedValue(new Error('Unavailable'));
  const onSave = vi.fn();
  render(<PfmeaRowEditor row={{ ...row(), actionsTaken:'' }} workspaceId="w" readOnly={false} onSave={onSave} onCancel={vi.fn()} />);
  await screen.findByText('Member directory unavailable. The existing owner is preserved.');
  expect(screen.getByRole('option',{name:'Existing owner (existing)'})).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Action status'), { target:{ value:'closed' } });
  fireEvent.click(screen.getByRole('checkbox'));
  expect(screen.getByRole('button',{name:'Save risk'})).toBeDisabled(); expect(onSave).not.toHaveBeenCalled();
});
