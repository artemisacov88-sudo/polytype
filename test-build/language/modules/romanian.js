"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.romanian = void 0;
exports.romanian = {
    id: "ro",
    displayName: "Румынский",
    rules: {
        tokenize(text) {
            return text.match(/[a-zăâîșț]+/giu) ?? [];
        },
        normalizeWord(word) {
            return word.toLocaleLowerCase("ro-RO");
        },
    },
};
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicm9tYW5pYW4uanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvbGFuZ3VhZ2UvbW9kdWxlcy9yb21hbmlhbi50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFFYSxRQUFBLFFBQVEsR0FBbUI7SUFDdkMsRUFBRSxFQUFFLElBQUk7SUFDUixXQUFXLEVBQUUsV0FBVztJQUV4QixLQUFLLEVBQUU7UUFDTixRQUFRLENBQUMsSUFBWTtZQUNwQixPQUFPLElBQUksQ0FBQyxLQUFLLENBQUMsZ0JBQWdCLENBQUMsSUFBSSxFQUFFLENBQUM7UUFDM0MsQ0FBQztRQUVELGFBQWEsQ0FBQyxJQUFZO1lBQ3pCLE9BQU8sSUFBSSxDQUFDLGlCQUFpQixDQUFDLE9BQU8sQ0FBQyxDQUFDO1FBQ3hDLENBQUM7S0FDRDtDQUNELENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgdHlwZSB7IExhbmd1YWdlTW9kdWxlIH0gZnJvbSBcIi4uL3R5cGVzXCI7XG5cbmV4cG9ydCBjb25zdCByb21hbmlhbjogTGFuZ3VhZ2VNb2R1bGUgPSB7XG5cdGlkOiBcInJvXCIsXG5cdGRpc3BsYXlOYW1lOiBcItCg0YPQvNGL0L3RgdC60LjQuVwiLFxuXG5cdHJ1bGVzOiB7XG5cdFx0dG9rZW5pemUodGV4dDogc3RyaW5nKTogc3RyaW5nW10ge1xuXHRcdFx0cmV0dXJuIHRleHQubWF0Y2goL1thLXrEg8Oiw67ImcibXSsvZ2l1KSA/PyBbXTtcblx0XHR9LFxuXG5cdFx0bm9ybWFsaXplV29yZCh3b3JkOiBzdHJpbmcpOiBzdHJpbmcge1xuXHRcdFx0cmV0dXJuIHdvcmQudG9Mb2NhbGVMb3dlckNhc2UoXCJyby1ST1wiKTtcblx0XHR9LFxuXHR9LFxufTsiXX0=