const P=(d:string)=><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={d}/></svg>;
export const ICONS:Record<string,JSX.Element>={
 menu:P('M3 6h18M3 12h18M3 18h18'),
 Dashboard:P('M3 11l9-8 9 8v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z'),
 'My Account':P('M4 20V10M10 20V4M16 20v-8M22 20H2'),
 Competitors:P('M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8'),
 'Content AI':P('M12 5v14M5 12h14'),
 Scheduling:P('M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2'),
 'Finance & Capital':P('M3 7h18v12H3zM3 7l3-4h12l3 4M16 13h2'),
 Settings:P('M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM4 12h2M18 12h2M12 4v2M12 18v2'),
 Roadmap:P('M9 20l-6-3V4l6 3 6-3 6 3v13l-6-3zM9 7v13M15 4v13'),
 logout:P('M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9'),
};
