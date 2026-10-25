import {api} from '../api';
import {itemsQuery} from './model';
import type {Item,Overview,ItemsQuery,Category,Status} from './model';

// Every album endpoint the page uses (contract 4.5). api() adds the bearer token, prefixes /api and throws Error(server message) on non-2xx.
const enc=encodeURIComponent;

export const getOverview=()=>api<Overview>('/albums');
export const getItems=(p:ItemsQuery)=>api<{items:Item[];next?:string}>('/albums/items'+itemsQuery(p));

export type ItemPatch=Partial<{title:string;caption:string;category:Category;folderId:string|null;status:Status;imageIds:string[]}>;
export const patchItem=(id:string,body:ItemPatch)=>api<{item:Item}>('/albums/items/'+enc(id),{method:'PATCH',body});
export const deleteItem=(id:string)=>api('/albums/items/'+enc(id),{method:'DELETE'}); // 204: api() returns {} for an empty body

export type MoveBody={ids:string[];folderId?:string|null;category?:Category};
export const moveItems=(body:MoveBody)=>api<{moved:number}>('/albums/items/move',{method:'POST',body});

export const createFolder=(name:string)=>api<{folder:{id:string;name:string}}>('/albums/folders',{method:'POST',body:{name}});
export const renameFolder=(id:string,name:string)=>api('/albums/folders/'+enc(id),{method:'PATCH',body:{name}});
export const deleteFolder=(id:string)=>api('/albums/folders/'+enc(id),{method:'DELETE'});