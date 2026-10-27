import test from 'node:test';
import assert from 'node:assert/strict';
import { preserveRenameExtension as rename } from './public/app/file-rename-name.js';
test('base-only rename preserves each file type',()=>{
 for(const ext of ['jpg','PNG','pdf','dwg']) assert.equal(rename('D:/sort/image.'+ext,'CQ02','file'),'CQ02.'+ext);
});
test('explicit extensions, folders, extensionless files and dotfiles retain their behavior',()=>{
 assert.equal(rename('D:/a.jpg','b.png','file'),'b.png');
 assert.equal(rename('D:/folder.old','folder','folder'),'folder');
 assert.equal(rename('D:/README','NEW','file'),'NEW');
 assert.equal(rename('D:/.gitignore','ignore','file'),'ignore');
 assert.equal(rename('D:/a.jpg','','file'),'');
});
