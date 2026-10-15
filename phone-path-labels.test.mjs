import test from 'node:test';import assert from 'node:assert/strict';
import {navigatorPhoneLabel} from './public/app/workspace-navigator.js';
test('phone labels decode spaces, Vietnamese and a literal percent exactly once',()=>{
 const root='\\\\papers~phone\\primary\\';
 for(const name of ['Greatest%20Tactician','Th%C3%A1%20ch%C3%B3','100%2520literal'])assert.equal(navigatorPhoneLabel(name,root+name),decodeURIComponent(name));
});
test('authored names, ordinary Windows names and malformed encodings are preserved',()=>{
 assert.equal(navigatorPhoneLabel('My folder','\\\\papers~phone\\primary\\Actual%20Folder'),'My folder');
 assert.equal(navigatorPhoneLabel('100%20','D:\\100%20'),'100%20');
 assert.equal(navigatorPhoneLabel('bad%','\\\\papers~phone\\primary\\bad%'),'bad%');
});
