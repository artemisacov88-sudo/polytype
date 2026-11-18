"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.german = void 0;
exports.german = {
    id: "de",
    displayName: "Немецкий",
    rules: {
        tokenize(text) {
            return text.match(/[a-zäöüß]+(?:['’-][a-zäöüß]+)*/giu) ?? [];
        },
        normalizeWord(word) {
            return word.toLocaleLowerCase("de-DE");
        },
    },
};
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZ2VybWFuLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2xhbmd1YWdlL21vZHVsZXMvZ2VybWFuLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUVhLFFBQUEsTUFBTSxHQUFtQjtJQUNyQyxFQUFFLEVBQUUsSUFBSTtJQUNSLFdBQVcsRUFBRSxVQUFVO0lBRXZCLEtBQUssRUFBRTtRQUNOLFFBQVEsQ0FBQyxJQUFZO1lBQ3BCLE9BQU8sSUFBSSxDQUFDLEtBQUssQ0FBQyxtQ0FBbUMsQ0FBQyxJQUFJLEVBQUUsQ0FBQztRQUM5RCxDQUFDO1FBRUQsYUFBYSxDQUFDLElBQVk7WUFDekIsT0FBTyxJQUFJLENBQUMsaUJBQWlCLENBQUMsT0FBTyxDQUFDLENBQUM7UUFDeEMsQ0FBQztLQUNEO0NBQ0QsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB0eXBlIHsgTGFuZ3VhZ2VNb2R1bGUgfSBmcm9tIFwiLi4vdHlwZXNcIjtcblxuZXhwb3J0IGNvbnN0IGdlcm1hbjogTGFuZ3VhZ2VNb2R1bGUgPSB7XG5cdGlkOiBcImRlXCIsXG5cdGRpc3BsYXlOYW1lOiBcItCd0LXQvNC10YbQutC40LlcIixcblxuXHRydWxlczoge1xuXHRcdHRva2VuaXplKHRleHQ6IHN0cmluZyk6IHN0cmluZ1tdIHtcblx0XHRcdHJldHVybiB0ZXh0Lm1hdGNoKC9bYS16w6TDtsO8w59dKyg/Olsn4oCZLV1bYS16w6TDtsO8w59dKykqL2dpdSkgPz8gW107XG5cdFx0fSxcblxuXHRcdG5vcm1hbGl6ZVdvcmQod29yZDogc3RyaW5nKTogc3RyaW5nIHtcblx0XHRcdHJldHVybiB3b3JkLnRvTG9jYWxlTG93ZXJDYXNlKFwiZGUtREVcIik7XG5cdFx0fSxcblx0fSxcbn07Il19