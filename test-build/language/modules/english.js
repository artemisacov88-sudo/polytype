"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.english = void 0;
exports.english = {
    id: "en",
    displayName: "Английский",
    rules: {
        tokenize(text) {
            return text.match(/[a-z]+(?:['’-][a-z]+)*/giu) ?? [];
        },
        normalizeWord(word) {
            return word.toLocaleLowerCase("en-US");
        },
    },
};
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZW5nbGlzaC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9sYW5ndWFnZS9tb2R1bGVzL2VuZ2xpc2gudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBRWEsUUFBQSxPQUFPLEdBQW1CO0lBQ3RDLEVBQUUsRUFBRSxJQUFJO0lBQ1IsV0FBVyxFQUFFLFlBQVk7SUFFekIsS0FBSyxFQUFFO1FBQ04sUUFBUSxDQUFDLElBQVk7WUFDcEIsT0FBTyxJQUFJLENBQUMsS0FBSyxDQUFDLDJCQUEyQixDQUFDLElBQUksRUFBRSxDQUFDO1FBQ3RELENBQUM7UUFFRCxhQUFhLENBQUMsSUFBWTtZQUN6QixPQUFPLElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxPQUFPLENBQUMsQ0FBQztRQUN4QyxDQUFDO0tBQ0Q7Q0FDRCxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHR5cGUgeyBMYW5ndWFnZU1vZHVsZSB9IGZyb20gXCIuLi90eXBlc1wiO1xuXG5leHBvcnQgY29uc3QgZW5nbGlzaDogTGFuZ3VhZ2VNb2R1bGUgPSB7XG5cdGlkOiBcImVuXCIsXG5cdGRpc3BsYXlOYW1lOiBcItCQ0L3Qs9C70LjQudGB0LrQuNC5XCIsXG5cblx0cnVsZXM6IHtcblx0XHR0b2tlbml6ZSh0ZXh0OiBzdHJpbmcpOiBzdHJpbmdbXSB7XG5cdFx0XHRyZXR1cm4gdGV4dC5tYXRjaCgvW2Etel0rKD86WyfigJktXVthLXpdKykqL2dpdSkgPz8gW107XG5cdFx0fSxcblxuXHRcdG5vcm1hbGl6ZVdvcmQod29yZDogc3RyaW5nKTogc3RyaW5nIHtcblx0XHRcdHJldHVybiB3b3JkLnRvTG9jYWxlTG93ZXJDYXNlKFwiZW4tVVNcIik7XG5cdFx0fSxcblx0fSxcbn07Il19