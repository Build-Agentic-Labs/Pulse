import React from 'react';
export default function Image({ unoptimized: _unoptimized, priority: _priority, fill: _fill, ...props }: React.ImgHTMLAttributes<HTMLImageElement> & { unoptimized?: boolean; priority?: boolean; fill?: boolean }) { return <img {...props} />; }
