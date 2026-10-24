import { fireEvent, render, screen } from '@testing-library/react';
import { describe,it,expect,vi } from 'vitest';
import { DatePicker } from './date-picker';
describe('app date picker',()=>{
 it('commits a chosen day as a calendar date',()=>{
  const change=vi.fn();render(<DatePicker label="Target date" value="2026-10-23" onChange={change}/>);
  fireEvent.click(screen.getByRole('button',{name:'Choose target date'}));
  fireEvent.click(screen.getByRole('button',{name:'Choose 10/30/2026'}));
  expect(change).toHaveBeenCalledWith('2026-10-30');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
 });
 it('accepts typing and does not commit an invalid date',()=>{
  const change=vi.fn();render(<DatePicker label="Target date" onChange={change}/>);
  const input=screen.getByLabelText('Target date');
  fireEvent.change(input,{target:{value:'2/30/2026'}});fireEvent.blur(input);
  expect(change).not.toHaveBeenCalled();expect(input).toHaveAttribute('aria-invalid','true');
  fireEvent.change(input,{target:{value:'10/30/2026'}});
  expect(change).toHaveBeenLastCalledWith('2026-10-30');
 });
});
